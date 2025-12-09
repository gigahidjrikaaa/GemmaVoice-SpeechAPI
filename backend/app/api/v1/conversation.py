"""Conversation endpoints for dialogue and real-time voice chat."""

from __future__ import annotations

import base64
import io
import json
import logging
import asyncio
import os
import subprocess
import tempfile
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
from fastapi.responses import StreamingResponse

from app.schemas.speech import (
    SpeechDialogueResponse,
    SpeechTranscriptionResponse,
    SpeechTranscriptionSegment,
)
from app.services.conversation import ConversationService, DialogueStreamResult
from app.services.whisper import WhisperTranscription
from app.security import (
    enforce_rate_limit,
    enforce_websocket_api_key,
    enforce_websocket_rate_limit,
    require_api_key,
)

logger = logging.getLogger(__name__)

# Router without global dependencies - WebSocket routes handle auth separately
router = APIRouter(tags=["Conversation"])

# Common dependencies for HTTP routes
http_dependencies = [Depends(require_api_key), Depends(enforce_rate_limit)]


async def _convert_webm_to_wav(webm_data: bytes) -> bytes | None:
    """Convert WebM audio to WAV format using FFmpeg.
    
    Returns WAV bytes or None if conversion fails.
    """
    try:
        # Write WebM to temp file
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as webm_file:
            webm_file.write(webm_data)
            webm_path = webm_file.name
        
        # Create output WAV path
        wav_path = webm_path.replace(".webm", ".wav")
        
        try:
            # Use FFmpeg to convert WebM to WAV (16kHz mono for Whisper)
            result = subprocess.run(
                [
                    "ffmpeg", "-y",  # Overwrite output
                    "-i", webm_path,  # Input file
                    "-vn",  # No video
                    "-acodec", "pcm_s16le",  # PCM 16-bit
                    "-ar", "16000",  # 16kHz sample rate (optimal for Whisper)
                    "-ac", "1",  # Mono
                    wav_path
                ],
                capture_output=True,
                timeout=30
            )
            
            if result.returncode != 0:
                logger.error("FFmpeg conversion failed: %s", result.stderr.decode())
                return None
            
            # Read the WAV file
            with open(wav_path, "rb") as wav_file:
                return wav_file.read()
                
        finally:
            # Cleanup temp files
            for path in [webm_path, wav_path]:
                try:
                    os.unlink(path)
                except OSError:
                    pass
                    
    except Exception as e:
        logger.error("Error converting WebM to WAV: %s", e)
        return None


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


def _get_conversation_service(request: Request) -> ConversationService:
    service: ConversationService | None = getattr(request.app.state, "conversation_service", None)
    if service is None:
        raise HTTPException(status_code=503, detail="Conversation service is unavailable")
    return service


@router.post(
    "/conversation/dialogue",
    response_model=SpeechDialogueResponse,
    summary="Run the full speech pipeline (STT -> LLM -> TTS) on an audio file.",
    tags=["Conversation"],
    dependencies=http_dependencies,
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


@router.websocket("/conversation/ws")
async def conversation_ws(websocket: WebSocket) -> None:
    """Real-time conversational WebSocket endpoint.
    
    Protocol:
    - Client sends JSON: {"type": "config", "data": {...}} (Optional initial config)
    - Client sends JSON: {"type": "audio", "data": "<base64_audio>"} (Audio chunk - WebM format from browser)
    - Client sends JSON: {"type": "end_turn"} (Signal end of user turn to process accumulated audio)
    - Client sends JSON: {"type": "text", "data": "text input"} (Text input override)
    
    Server sends JSON:
    - {"type": "ready", "message": "..."} (Ready to receive audio)
    - {"type": "buffering", "chunks": N} (Audio chunk received, buffering)
    - {"type": "transcript", "role": "user", "content": "..."} (User transcript)
    - {"type": "text", "role": "assistant", "content": "..."} (Assistant response text)
    - {"type": "audio", "data": "<base64_audio>"} (Assistant response audio chunk)
    - {"type": "error", "message": "..."}
    """
    if not await enforce_websocket_api_key(websocket):
        return
    if not await enforce_websocket_rate_limit(websocket):
        return
        
    await websocket.accept()
    
    conversation_service: ConversationService | None = getattr(
        websocket.app.state, "conversation_service", None
    )
    
    if conversation_service is None:
        await websocket.close(code=1011, reason="Service unavailable")
        return

    # Session state
    audio_buffer = io.BytesIO()  # Buffer for accumulating WebM chunks
    audio_format = "webm"  # Track the audio format (webm or wav)
    instructions = "You are a helpful voice assistant. Keep responses concise and conversational."
    
    await websocket.send_json({"type": "ready", "message": "Connected. Send audio chunks, then 'end_turn' to process."})
    
    try:
        while True:
            message = await websocket.receive_json()
            msg_type = message.get("type")
            
            if msg_type == "config":
                # Update session configuration
                config_data = message.get("data", {})
                if "instructions" in config_data:
                    instructions = config_data["instructions"]
                await websocket.send_json({"type": "configured", "instructions": instructions[:50] + "..."})
            
            elif msg_type == "audio":
                # Accumulate audio chunks
                # VAD mode sends pre-converted WAV; Push-to-talk sends WebM chunks
                try:
                    audio_data = base64.b64decode(message.get("data", ""))
                    # Check if format is specified (VAD sends format: "wav")
                    if message.get("format") == "wav":
                        audio_format = "wav"
                    audio_buffer.write(audio_data)
                    chunk_count = audio_buffer.tell() // 1000  # Rough chunk count
                    await websocket.send_json({"type": "buffering", "chunks": chunk_count, "bytes": audio_buffer.tell()})
                except Exception as e:
                    logger.error("Error decoding audio chunk: %s", e)
                    await websocket.send_json({"type": "error", "message": "Invalid audio data"})
            
            elif msg_type == "end_turn":
                # Process accumulated audio as a complete turn
                raw_audio = audio_buffer.getvalue()
                buffer_size = len(raw_audio)
                logger.info("Processing end_turn with %d bytes of %s audio", buffer_size, audio_format)
                
                if buffer_size < 100:
                    await websocket.send_json({"type": "error", "message": f"Not enough audio data ({buffer_size} bytes). Hold the button longer."})
                    audio_buffer = io.BytesIO()  # Reset buffer
                    audio_format = "webm"  # Reset format
                    continue
                
                try:
                    # Convert to WAV if needed (VAD already sends WAV)
                    if audio_format == "wav":
                        await websocket.send_json({"type": "processing", "message": "Transcribing..."})
                        wav_data = raw_audio
                    else:
                        await websocket.send_json({"type": "processing", "message": "Converting audio..."})
                        wav_data = await _convert_webm_to_wav(raw_audio)
                        
                        if wav_data is None:
                            await websocket.send_json({"type": "error", "message": "Audio conversion failed"})
                            audio_buffer = io.BytesIO()
                            audio_format = "webm"
                            continue
                        
                        await websocket.send_json({"type": "processing", "message": "Transcribing..."})
                    
                    # Run the full pipeline with WAV audio
                    result = await conversation_service.run_dialogue(
                        audio_bytes=wav_data,
                        filename="live_input.wav",
                        content_type="audio/wav",
                        instructions=instructions,
                        stream_audio=True
                    )
                    
                    # Send transcript
                    await websocket.send_json({
                        "type": "transcript",
                        "role": "user",
                        "content": result.transcription.text
                    })
                    
                    # Send assistant text
                    await websocket.send_json({
                        "type": "text",
                        "role": "assistant",
                        "content": result.response_text
                    })
                    
                    # Stream audio response
                    if isinstance(result, DialogueStreamResult):
                        async for chunk in result.synthesis_stream.iterator_factory():
                            if chunk:
                                encoded = base64.b64encode(chunk).decode("ascii")
                                await websocket.send_json({
                                    "type": "audio",
                                    "data": encoded
                                })
                    
                    # Reset buffer for next turn
                    audio_buffer = io.BytesIO()
                    audio_format = "webm"  # Reset to default
                    await websocket.send_json({"type": "ready", "message": "Ready for next turn"})
                    
                except Exception as e:
                    logger.exception("Error processing audio turn")
                    await websocket.send_json({
                        "type": "error",
                        "message": str(e)
                    })
                    audio_buffer = io.BytesIO()  # Reset on error
                    audio_format = "webm"
                    
            elif msg_type == "text":
                # Handle text input (bypass STT)
                pass
                
    except WebSocketDisconnect:
        logger.info("Client disconnected from conversation WebSocket")
    except Exception as exc:
        logger.exception("Unexpected error in conversation WebSocket")
        try:
            await websocket.close(code=1011, reason="Internal error")
        except:
            pass
