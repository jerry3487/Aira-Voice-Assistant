"""Real-time WebSocket voice conversation handler with barge-in cancellation."""

from __future__ import annotations

import asyncio
import base64
import json
import uuid
from typing import Any, Dict

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.models.schemas import ConversationState

ws_router = APIRouter()


@ws_router.websocket("/ws/voice")
async def voice_websocket(websocket: WebSocket) -> None:
    await websocket.accept()
    app = websocket.app
    conv_id = str(uuid.uuid4())
    active_task: asyncio.Task | None = None
    cancelled = False
    pcm_buffer = bytearray()

    async def send_event(event_type: str, payload: Dict[str, Any]) -> None:
        await websocket.send_text(json.dumps({"type": event_type, **payload}, ensure_ascii=False))

    async def on_state(state: ConversationState, extra: Dict[str, Any]) -> None:
        await send_event("state", {"state": state.value, **extra})

    async def run_turn(user_text: str, stt_ms: float, stt_lang: str, resp_lang: str, voice_id: str | None) -> None:
        nonlocal cancelled
        cancelled = False
        try:
            async def on_token(delta: str) -> None:
                await send_event("assistant_token", {"delta": delta})

            turn = await app.state.conversation.process_text_turn(
                conversation_id=conv_id,
                user_text=user_text,
                detected_language=stt_lang,
                response_language=resp_lang,
                on_state=on_state,
                on_token=on_token,
                cancel_flag=lambda: cancelled,
            )
            turn.metrics.stt_ms = stt_ms
            turn.metrics.total_ms += stt_ms

            if cancelled:
                await on_state(ConversationState.INTERRUPTED, {})
                return

            await on_state(ConversationState.SPEAKING, {"language": resp_lang})
            tts_res = app.state.tts.synthesize_wav(
                turn.assistant_text, voice_id=voice_id, response_language=resp_lang
            )
            turn.metrics.tts_ms = tts_res.get("duration_ms", 0.0)
            turn.metrics.total_ms += turn.metrics.tts_ms

            audio_b64 = None
            if tts_res.get("ok") and tts_res.get("wav_bytes"):
                audio_b64 = base64.b64encode(tts_res["wav_bytes"]).decode("ascii")

            await send_event(
                "assistant_done",
                {
                    "conversation_id": conv_id,
                    "text": turn.assistant_text,
                    "language": resp_lang,
                    "tool_calls": [t.__dict__ for t in turn.tool_calls],
                    "metrics": turn.metrics.to_dict(),
                    "audio_wav_base64": audio_b64,
                    "tts_warning": tts_res.get("message") if not tts_res.get("ok") else None,
                },
            )
        except Exception as exc:
            await on_state(ConversationState.ERROR, {"error": str(exc)})

    await on_state(ConversationState.IDLE, {"conversation_id": conv_id})

    try:
        while True:
            raw = await websocket.receive_text()
            msg = json.loads(raw)
            mtype = msg.get("type")

            if mtype == "interrupt":
                cancelled = True
                if active_task and not active_task.done():
                    active_task.cancel()
                pcm_buffer.clear()
                await on_state(ConversationState.INTERRUPTED, {})
                await on_state(ConversationState.LISTENING, {})

            elif mtype == "audio_chunk":
                chunk_b64 = msg.get("pcm16_base64", "")
                if chunk_b64:
                    pcm_buffer.extend(base64.b64decode(chunk_b64))

            elif mtype == "audio_end":
                if not pcm_buffer:
                    await on_state(ConversationState.IDLE, {})
                    continue
                await on_state(ConversationState.TRANSCRIBING, {})
                wav_bytes = app.state.speech.pcm16_to_wav(bytes(pcm_buffer))
                pcm_buffer.clear()
                stt_lang = msg.get("stt_language", "auto")
                resp_lang = msg.get("response_language", "en")
                voice_id = msg.get("voice_id")
                stt_res = await asyncio.to_thread(
                    app.state.speech.transcribe_wav_bytes, wav_bytes, stt_lang
                )
                text = stt_res.get("text", "").strip()
                if not text:
                    await on_state(ConversationState.LISTENING, {})
                    continue
                await send_event(
                    "transcript",
                    {
                        "text": text,
                        "language": stt_res.get("language", "en"),
                        "stt_ms": stt_res.get("duration_ms", 0.0),
                    },
                )
                active_task = asyncio.create_task(
                    run_turn(
                        text,
                        stt_res.get("duration_ms", 0.0),
                        stt_res.get("language", "en"),
                        resp_lang,
                        voice_id,
                    )
                )

            elif mtype == "user_text":
                text = (msg.get("text") or "").strip()
                if not text:
                    continue
                stt_lang = msg.get("stt_language", "en")
                resp_lang = msg.get("response_language", "en")
                voice_id = msg.get("voice_id")
                active_task = asyncio.create_task(
                    run_turn(text, 0.0, stt_lang, resp_lang, voice_id)
                )

    except WebSocketDisconnect:
        cancelled = True
        if active_task and not active_task.done():
            active_task.cancel()
