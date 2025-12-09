"""Speech endpoints for transcription, synthesis and dialogue orchestration."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import io
import time
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

# Router without global dependencies - WebSocket routes handle auth separately
router = APIRouter()

# Common dependencies for HTTP routes
http_dependencies = [Depends(require_api_key), Depends(enforce_rate_limit)]


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
    dependencies=http_dependencies,
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
    dependencies=http_dependencies,
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
    dependencies=http_dependencies,
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

        async def sse_iterator() -> AsyncIterator[str]:
            """Stream audio as SSE events with base64 encoded chunks."""
            import base64
            async for chunk in stream_result.iterator_factory():
                # Encode chunk as base64 for SSE transport
                chunk_b64 = base64.b64encode(chunk).decode('ascii')
                # Format as SSE event
                yield f"event: audio_chunk\ndata: {json.dumps(chunk_b64)}\n\n"
            
            # Send completion event
            yield f"event: done\ndata: {json.dumps({'status': 'complete'})}\n\n"

        headers = {
            "x-audio-format": stream_result.response_format,
            "x-sample-rate": str(stream_result.sample_rate),
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
        if stream_result.reference_id:
            headers["x-reference-id"] = stream_result.reference_id
        return StreamingResponse(
            sse_iterator(), 
            media_type="text/event-stream", 
            headers=headers
        )

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
    wants_binary = "audio/" in accept_header or (
        payload.format is not None and payload.format in accept_header
    )
    if wants_binary:
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


class StreamingTranscriber:
    """Handles real-time streaming transcription with interim results.
    
    Note: WebM/Opus from browser MediaRecorder requires accumulating all chunks
    because each chunk depends on the initialization segment (header) from the 
    first chunk. We accumulate the full WebM stream and convert to WAV for Whisper.
    """
    
    def __init__(
        self,
        whisper_service: WhisperService,
        websocket: WebSocket,
        chunk_duration_ms: int = 3000,  # Process every 3 seconds for better context
        overlap_ms: int = 500,  # Overlap for better word boundaries
    ):
        self.whisper_service = whisper_service
        self.websocket = websocket
        self.chunk_duration_ms = chunk_duration_ms
        self.overlap_ms = overlap_ms
        
        # Full WebM stream buffer - keeps all data including header
        self.webm_buffer = io.BytesIO()
        self.last_process_time = time.time()
        self.is_processing = False
        self.final_transcript = ""
        self.interim_transcript = ""
        self.last_transcribed_position = 0  # Track what we've already transcribed
        
        # Configuration from client
        self.language: str | None = None
        self.response_format: str = "verbose_json"
        self.temperature: float = 0.0
        
    async def add_audio_chunk(self, chunk: bytes) -> None:
        """Add audio chunk to the WebM stream buffer."""
        self.webm_buffer.write(chunk)
        
        current_time = time.time()
        elapsed_ms = (current_time - self.last_process_time) * 1000
        
        # Process if we have enough audio and not already processing
        if elapsed_ms >= self.chunk_duration_ms and not self.is_processing:
            await self._process_buffer(is_final=False)
            self.last_process_time = current_time
    
    async def finalize(self) -> None:
        """Process any remaining audio as final transcript."""
        if self.webm_buffer.tell() > 0:
            await self._process_buffer(is_final=True)
    
    async def _convert_webm_to_wav(self, webm_data: bytes) -> bytes | None:
        """Convert WebM audio to WAV format using FFmpeg.
        
        Returns WAV bytes or None if conversion fails.
        """
        import subprocess
        import tempfile
        import os
        
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
    
    async def _process_buffer(self, is_final: bool = False) -> None:
        """Process accumulated WebM audio buffer by converting to WAV and transcribing."""
        if self.is_processing:
            return
            
        self.is_processing = True
        try:
            # Get the full WebM stream (including header)
            webm_data = self.webm_buffer.getvalue()
            
            if len(webm_data) < 1000:  # Skip if too little data
                if is_final:
                    await self.websocket.send_json({
                        "event": "final",
                        "data": {
                            "text": self.final_transcript,
                            "is_final": True
                        }
                    })
                return
            
            # Convert WebM to WAV for Whisper
            wav_data = await self._convert_webm_to_wav(webm_data)
            
            if wav_data is None:
                await self.websocket.send_json({
                    "event": "warning",
                    "detail": "Audio conversion failed, skipping chunk"
                })
                return
            
            # Transcribe the WAV audio
            try:
                transcription = await self.whisper_service.transcribe(
                    wav_data,
                    filename="stream.wav",
                    content_type="audio/wav",
                    language=self.language,
                    response_format=self.response_format,
                    temperature=self.temperature,
                )
                
                transcript_text = transcription.text.strip()
                
                if transcript_text:
                    if is_final:
                        # Use the full transcription as final result
                        self.final_transcript = transcript_text
                        
                        await self.websocket.send_json({
                            "event": "final",
                            "data": {
                                "text": self.final_transcript,
                                "language": transcription.language,
                                "segments": [
                                    {
                                        "id": seg.id,
                                        "start": seg.start,
                                        "end": seg.end,
                                        "text": seg.text
                                    }
                                    for seg in transcription.segments
                                ],
                                "is_final": True
                            }
                        })
                    else:
                        # Send interim result (transcription of audio so far)
                        self.interim_transcript = transcript_text
                        await self.websocket.send_json({
                            "event": "interim",
                            "data": {
                                "text": transcript_text,
                                "language": transcription.language,
                                "is_final": False
                            }
                        })
                        
            except Exception as e:
                logger.error("Transcription error: %s", e)
                await self.websocket.send_json({
                    "event": "error",
                    "detail": f"Transcription failed: {str(e)}"
                })
                
        finally:
            self.is_processing = False


@router.websocket("/speech-to-text/stream")
async def speech_to_text_stream(websocket: WebSocket) -> None:
    """Real-time streaming speech-to-text with interim results.
    
    This endpoint provides true streaming transcription:
    - Send binary audio chunks continuously
    - Receive interim (partial) transcription results in real-time
    - Receive final transcription when audio stops
    
    Protocol:
    1. Connect to WebSocket
    2. Send JSON config: {"language": "en", "interim_results": true}
    3. Send binary audio chunks (WebM/Opus format recommended)
    4. Receive interim results: {"event": "interim", "data": {"text": "...", "is_final": false}}
    5. Send JSON {"event": "stop"} to finalize
    6. Receive final result: {"event": "final", "data": {"text": "...", "is_final": true}}
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
    
    # Create streaming transcriber
    transcriber = StreamingTranscriber(whisper_service, websocket)
    
    # Send ready message
    await websocket.send_json({"event": "ready", "message": "Send audio chunks to begin transcription"})
    
    try:
        while True:
            message = await websocket.receive()
            
            if "bytes" in message:
                # Binary audio chunk
                chunk = message["bytes"]
                if chunk:
                    await transcriber.add_audio_chunk(chunk)
                    
            elif "text" in message:
                try:
                    payload = json.loads(message["text"])
                except json.JSONDecodeError:
                    await websocket.send_json({"event": "error", "detail": "Invalid JSON"})
                    continue
                
                event_type = payload.get("event")
                
                if event_type == "config":
                    # Update configuration
                    transcriber.language = payload.get("language")
                    transcriber.response_format = payload.get("response_format", "verbose_json")
                    transcriber.temperature = payload.get("temperature", 0.0)
                    await websocket.send_json({"event": "configured", "config": {
                        "language": transcriber.language,
                        "response_format": transcriber.response_format,
                        "temperature": transcriber.temperature
                    }})
                    
                elif event_type == "stop":
                    # Finalize transcription
                    await transcriber.finalize()
                    break
                    
                elif event_type == "clear":
                    # Reset transcriber state
                    transcriber.webm_buffer = io.BytesIO()
                    transcriber.final_transcript = ""
                    transcriber.interim_transcript = ""
                    await websocket.send_json({"event": "cleared"})
                    
    except WebSocketDisconnect:
        logger.info("Client disconnected from streaming speech-to-text")
    except Exception as exc:
        logger.exception("Error in streaming speech-to-text handler")
        try:
            await websocket.close(code=1011, reason="Internal server error")
        except Exception:
            pass



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
