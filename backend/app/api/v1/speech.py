"""Speech endpoints for transcription, synthesis and dialogue orchestration."""

from __future__ import annotations

import base64
import json
import logging
import io
from typing import Any, AsyncIterator, Dict

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import StreamingResponse, Response

from app.schemas.speech import (
    SpeechDialogueResponse,
    SpeechSynthesisRequest,
    SpeechSynthesisResponse,
    SpeechTranscriptionResponse,
    SpeechTranscriptionSegment,
)
from app.services.conversation import ConversationService, DialogueStreamResult
from app.services.openaudio import OpenAudioService
from app.services.whisper import WhisperService, WhisperTranscription
from app.security import (
    enforce_rate_limit,
    enforce_websocket_api_key,
    enforce_websocket_rate_limit,
    require_api_key,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    dependencies=[Depends(require_api_key), Depends(enforce_rate_limit)],
)


def _parse_json_field(raw_value: str | None, field_name: str) -> Dict[str, Any]:
    """Parse a JSON object supplied as a form field."""

    if raw_value in (None, "", "null"):
        return {}
    try:
        parsed = json.loads(raw_value)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON for '{field_name}'") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=400, detail=f"Field '{field_name}' must be a JSON object")
    return parsed


def _build_transcription_model(
    transcription: WhisperTranscription,
) -> SpeechTranscriptionResponse:
    segments = [
        SpeechTranscriptionSegment(
            id=segment.id,
            start=segment.start,
            end=segment.end,
            text=segment.text,
        )
        for segment in transcription.segments
    ]
    return SpeechTranscriptionResponse(
        text=transcription.text,
        language=transcription.language,
        segments=segments,
    )


def _get_whisper_service(request: Request) -> WhisperService:
    service: WhisperService | None = getattr(request.app.state, "whisper_service", None)
    if service is None or not service.is_ready:
        raise HTTPException(status_code=503, detail="Whisper service is unavailable")
    return service


def _get_openaudio_service(request: Request) -> OpenAudioService:
    service: OpenAudioService | None = getattr(request.app.state, "openaudio_service", None)
    if service is None or not service.is_ready:
        raise HTTPException(status_code=503, detail="OpenAudio service is unavailable")
    return service


def _get_conversation_service(request: Request) -> ConversationService:
    service: ConversationService | None = getattr(request.app.state, "conversation_service", None)
    if service is None:
        raise HTTPException(status_code=503, detail="Conversation service is unavailable")
    return service


@router.post(
    "/speech-to-text",
    response_model=SpeechTranscriptionResponse,
    summary="Transcribe uploaded audio with Whisper",
    tags=["STT (Whisper)"],
)
async def speech_to_text(
    file: UploadFile = File(..., description="Audio file to transcribe."),
    language: str | None = Form(default=None, description="Optional language hint."),
    prompt: str | None = Form(default=None, description="Optional priming prompt."),
    response_format: str | None = Form(default=None, description="Override Whisper response format."),
    temperature: float | None = Form(default=None, description="Sampling temperature."),
    whisper_service: WhisperService = Depends(_get_whisper_service),
) -> SpeechTranscriptionResponse:
    """Run Whisper on the provided audio payload."""

    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Uploaded audio file was empty")

    logger.info("Transcribing audio file '%s' (%s bytes)", file.filename, len(audio_bytes))

    transcription = await whisper_service.transcribe(
        audio_bytes,
        filename=file.filename or "audio.wav",
        content_type=file.content_type,
        language=language,
        prompt=prompt,
        response_format=response_format,
        temperature=temperature,
    )

    segments = [
        SpeechTranscriptionSegment(
            id=segment.id,
            start=segment.start,
            end=segment.end,
            text=segment.text,
        )
        for segment in transcription.segments
    ]

    return SpeechTranscriptionResponse(
        text=transcription.text,
        language=transcription.language,
        segments=segments,
    )


@router.post(
    "/encode-reference",
    response_model=Dict[str, str],
    summary="Encode audio file for voice cloning",
    description="Upload an audio file to get its base64 representation for use in the 'references' field of text-to-speech requests.",
    tags=["TTS (OpenAudio)"],
)
async def encode_reference(
    file: UploadFile = File(..., description="Audio file to encode (wav, mp3, etc)."),
) -> Dict[str, str]:
    """Helper endpoint to encode audio for voice cloning."""
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file was empty")
    
    encoded = base64.b64encode(audio_bytes).decode("ascii")
    return {"reference_base64": encoded}


@router.post(
    "/text-to-speech",
    response_model=SpeechSynthesisResponse,
    summary="Synthesize speech with OpenAudio",
    tags=["TTS (OpenAudio)"],
    responses={
        200: {
            "description": "Audio response (Base64 JSON or Binary Audio).",
            "content": {
                "application/json": {},
                "audio/wav": {},
                "audio/mpeg": {},
            }
        },
    },
)
async def text_to_speech(
    payload: SpeechSynthesisRequest,
    request: Request,
    openaudio_service: OpenAudioService = Depends(_get_openaudio_service),
):
    """Generate speech audio from text.
    
    Returns either a JSON object with base64-encoded audio (default) or binary audio
    if the 'Accept' header is set to an audio type (e.g., 'audio/wav') or if 'stream' is True.
    """

    if payload.stream:
        stream_result = await openaudio_service.synthesize_stream(
            text=payload.text,
            response_format=payload.format,
            sample_rate=payload.sample_rate,
            reference_id=payload.reference_id,
            normalize=payload.normalize,
            references=payload.references,
            top_p=payload.top_p,
            temperature=payload.temperature,
            chunk_length=payload.chunk_length,
            latency=payload.latency,
            speed=payload.speed,
            volume=payload.volume,
        )

        async def iterator() -> AsyncIterator[bytes]:
            async for chunk in stream_result.iterator_factory():
                yield chunk

        headers = {
            "x-audio-format": stream_result.response_format,
            "x-sample-rate": str(stream_result.sample_rate),
        }
        if stream_result.reference_id:
            headers["x-reference-id"] = stream_result.reference_id
        return StreamingResponse(iterator(), media_type=stream_result.media_type, headers=headers)

    synthesis = await openaudio_service.synthesize(
        text=payload.text,
        response_format=payload.format,
        sample_rate=payload.sample_rate,
        reference_id=payload.reference_id,
        normalize=payload.normalize,
        references=payload.references,
        top_p=payload.top_p,
        temperature=payload.temperature,
        chunk_length=payload.chunk_length,
        latency=payload.latency,
        speed=payload.speed,
        volume=payload.volume,
    )
    
    # Check if client requested binary audio via Accept header
    accept_header = request.headers.get("accept", "")
    if "audio/" in accept_header or payload.format in accept_header:
        headers = {
            "x-audio-format": synthesis.response_format,
            "x-sample-rate": str(synthesis.sample_rate),
        }
        if synthesis.reference_id:
            headers["x-reference-id"] = synthesis.reference_id
            
        return Response(
            content=synthesis.audio,
            media_type=synthesis.media_type,
            headers=headers
        )

    return SpeechSynthesisResponse(
        audio_base64=synthesis.as_base64(),
        response_format=synthesis.response_format,
        media_type=synthesis.media_type,
        sample_rate=synthesis.sample_rate,
        reference_id=synthesis.reference_id,
    )


@router.post(
    "/dialogue",
    response_model=SpeechDialogueResponse,
    summary="Run the full speech pipeline and return synthesised audio.",
    tags=["Dialogue"],
)
async def dialogue(
    file: UploadFile = File(..., description="Audio file containing the user utterance."),
    instructions: str | None = Form(
        default=None,
        description="Optional high-level instructions that condition the assistant response.",
    ),
    generation_config: str | None = Form(
        default=None,
        description="JSON overrides for GenerationRequest fields (prompt is ignored).",
    ),
    synthesis_config: str | None = Form(
        default=None,
        description="JSON overrides for speech synthesis (text and stream are ignored).",
    ),
    stream_audio: bool = Form(
        default=False,
        description="When true, stream newline-delimited JSON events with audio chunks.",
    ),
    conversation_service: ConversationService = Depends(_get_conversation_service),
):
    """Process uploaded audio and return both transcript and synthesised reply."""

    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Uploaded audio file was empty")

    generation_overrides = _parse_json_field(generation_config, "generation_config")
    synthesis_overrides = _parse_json_field(synthesis_config, "synthesis_config")

    try:
        result = await conversation_service.run_dialogue(
            audio_bytes=audio_bytes,
            filename=file.filename or "audio.wav",
            content_type=file.content_type,
            instructions=instructions,
            generation_overrides=generation_overrides,
            synthesis_overrides=synthesis_overrides,
            stream_audio=bool(stream_audio),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        logger.exception("Dialogue pipeline failed")
        raise HTTPException(status_code=503, detail="Speech services are unavailable") from exc
    except Exception as exc:  # pragma: no cover - defensive safeguard
        logger.exception("Unexpected error during dialogue pipeline")
        raise HTTPException(status_code=500, detail="Failed to process dialogue request.") from exc

    transcript_model = _build_transcription_model(result.transcription)

    if isinstance(result, DialogueStreamResult):

        async def dialogue_stream() -> AsyncIterator[str]:
            metadata = {
                "response_format": result.synthesis_stream.response_format,
                "media_type": result.synthesis_stream.media_type,
                "sample_rate": result.synthesis_stream.sample_rate,
            }
            if result.synthesis_stream.reference_id is not None:
                metadata["reference_id"] = result.synthesis_stream.reference_id
            yield json.dumps({"event": "metadata", "data": metadata}) + "\n"
            yield json.dumps({"event": "transcript", "data": transcript_model.model_dump()}) + "\n"
            yield json.dumps(
                {"event": "assistant_text", "data": {"text": result.response_text}}
            ) + "\n"
            async for chunk in result.synthesis_stream.iterator_factory():
                if not chunk:
                    continue
                encoded = base64.b64encode(chunk).decode("ascii")
                yield json.dumps({"event": "audio_chunk", "data": {"audio_base64": encoded}}) + "\n"
            yield json.dumps({"event": "done"}) + "\n"

        return StreamingResponse(dialogue_stream(), media_type="application/json")

    synthesis = result.synthesis
    return SpeechDialogueResponse(
        transcript=transcript_model,
        response_text=result.response_text,
        audio_base64=synthesis.as_base64(),
        response_format=synthesis.response_format,
        media_type=synthesis.media_type,
        sample_rate=synthesis.sample_rate,
        reference_id=synthesis.reference_id,
    )


@router.websocket("/speech-to-text/ws")
async def speech_to_text_ws(websocket: WebSocket) -> None:
    """WebSocket endpoint for speech-to-text.
    
    Supports two modes:
    1. JSON mode: Send JSON messages with 'audio_base64' field.
    2. Binary mode: Send raw binary audio chunks.
    """
    if not await enforce_websocket_api_key(websocket):
        return
    if not await enforce_websocket_rate_limit(websocket):
        return
    await websocket.accept()

    whisper_service: WhisperService | None = getattr(websocket.app.state, "whisper_service", None)
    if whisper_service is None or not whisper_service.is_ready:
        await websocket.close(code=1013, reason="Whisper service is unavailable")
        return

    # Buffer for binary audio chunks
    audio_buffer = io.BytesIO()
    
    try:
        while True:
            # Wait for message
            message = await websocket.receive()
            
            if "bytes" in message:
                # Handle binary audio chunk
                chunk = message["bytes"]
                if chunk:
                    audio_buffer.write(chunk)
                    
                    # For now, we'll transcribe periodically or on specific command
                    # This is a simplified "streaming" implementation that accumulates
                    # and waits for a "commit" or processes chunks.
                    # A true streaming implementation would use a VAD or sliding window.
                    # Here we'll just acknowledge receipt.
                    await websocket.send_json({"event": "received", "bytes": len(chunk)})
                    
            elif "text" in message:
                # Handle JSON message
                try:
                    payload = json.loads(message["text"])
                except json.JSONDecodeError:
                    await websocket.send_json({"event": "error", "detail": "Invalid JSON"})
                    continue
                
                event_type = payload.get("event")
                
                if event_type == "commit" or payload.get("audio_base64"):
                    # Process buffered audio or new base64 audio
                    if payload.get("audio_base64"):
                        try:
                            audio_bytes = base64.b64decode(payload["audio_base64"])
                        except (ValueError, TypeError):
                            await websocket.send_json({"event": "error", "detail": "Invalid base64"})
                            continue
                    else:
                        # Process buffer
                        audio_bytes = audio_buffer.getvalue()
                        # Reset buffer after commit
                        audio_buffer = io.BytesIO()
                    
                    if not audio_bytes:
                        await websocket.send_json({"event": "warning", "detail": "No audio to transcribe"})
                        continue
                        
                    try:
                        transcription = await whisper_service.transcribe(
                            audio_bytes,
                            filename=payload.get("filename") or "stream.wav",
                            content_type=payload.get("content_type"),
                            language=payload.get("language"),
                            prompt=payload.get("prompt"),
                            response_format=payload.get("response_format"),
                            temperature=payload.get("temperature"),
                        )
                        
                        transcript_model = _build_transcription_model(transcription)
                        await websocket.send_json({
                            "event": "transcript",
                            "data": transcript_model.model_dump()
                        })
                        
                    except RuntimeError:
                        await websocket.send_json({"event": "error", "detail": "Transcription failed"})
                
                elif event_type == "clear":
                    audio_buffer = io.BytesIO()
                    await websocket.send_json({"event": "cleared"})
                    
    except WebSocketDisconnect:
        logger.info("Client disconnected from speech-to-text WebSocket")
    except Exception as exc:
        logger.exception("Error in speech-to-text WebSocket handler")
        try:
            await websocket.close(code=1011, reason="Internal server error")
        except Exception:
            pass


@router.websocket("/text-to-speech/ws")
async def text_to_speech_ws(websocket: WebSocket) -> None:
    if not await enforce_websocket_api_key(websocket):
        return
    if not await enforce_websocket_rate_limit(websocket):
        return
    await websocket.accept()

    openaudio_service: OpenAudioService | None = getattr(
        websocket.app.state, "openaudio_service", None
    )
    if openaudio_service is None or not openaudio_service.is_ready:
        await websocket.close(code=1013, reason="OpenAudio service is unavailable")
        return

    try:
        while True:
            payload = await websocket.receive_json()
            text = payload.get("text") or payload.get("input")
            if not text:
                await websocket.send_json({"event": "error", "detail": "Missing 'text' field."})
                continue

            stream = payload.get("stream", True)
            synthesis_kwargs = {
                "response_format": payload.get("response_format") or payload.get("format"),
                "sample_rate": payload.get("sample_rate"),
                "reference_id": payload.get("reference_id"),
                "normalize": payload.get("normalize"),
                "references": payload.get("references"),
                "top_p": payload.get("top_p"),
                "temperature": payload.get("temperature"),
                "chunk_length": payload.get("chunk_length"),
                "latency": payload.get("latency"),
                "speed": payload.get("speed"),
                "volume": payload.get("volume"),
            }

            try:
                if stream:
                    stream_result = await openaudio_service.synthesize_stream(
                        text=text, **synthesis_kwargs
                    )
                    metadata_payload = {
                        "response_format": stream_result.response_format,
                        "media_type": stream_result.media_type,
                        "sample_rate": stream_result.sample_rate,
                    }
                    if stream_result.reference_id is not None:
                        metadata_payload["reference_id"] = stream_result.reference_id
                    await websocket.send_json(
                        {"event": "metadata", "data": metadata_payload}
                    )
                    async for chunk in stream_result.iterator_factory():
                        if not chunk:
                            continue
                        encoded = base64.b64encode(chunk).decode("ascii")
                        await websocket.send_json(
                            {"event": "audio_chunk", "data": {"audio_base64": encoded}}
                        )
                    await websocket.send_json({"event": "done"})
                else:
                    synthesis = await openaudio_service.synthesize(text=text, **synthesis_kwargs)
                    synthesis_payload = {
                        "audio_base64": synthesis.as_base64(),
                        "response_format": synthesis.response_format,
                        "media_type": synthesis.media_type,
                        "sample_rate": synthesis.sample_rate,
                    }
                    if synthesis.reference_id is not None:
                        synthesis_payload["reference_id"] = synthesis.reference_id
                    await websocket.send_json(
                        {"event": "synthesis", "data": synthesis_payload}
                    )
            except RuntimeError:
                await websocket.send_json(
                    {"event": "error", "detail": "Failed to synthesise audio with OpenAudio."}
                )
    except WebSocketDisconnect:
        logger.info("Client disconnected from text-to-speech WebSocket")
    except Exception as exc:  # pragma: no cover - defensive safeguard
        logger.exception("Error in text-to-speech WebSocket handler")
        await websocket.close(code=1011, reason="Internal server error")
