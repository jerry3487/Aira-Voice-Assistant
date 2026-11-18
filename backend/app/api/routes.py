"""REST endpoints for MCP console, local models, voices, memories, notes, and system metrics."""

from __future__ import annotations

import base64
import json
from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.database.sqlite import get_db


router = APIRouter(prefix="/api")


class SttTranscribeBody(BaseModel):
    wav_base64: str
    language: str | None = None


class TtsSynthesizeBody(BaseModel):
    text: str
    voice_id: str | None = None
    response_language: str = "en"
    speed: float | None = None


class ToolCallBody(BaseModel):
    arguments: Dict[str, Any] = {}


class ToolToggleBody(BaseModel):
    enabled: bool


class ModelSelectBody(BaseModel):
    model: str
    system_prompt: str | None = None


class VoiceConfigBody(BaseModel):
    voice_id: str | None = None
    speed: float | None = None


@router.get("/health")
async def health(request: Request) -> Dict[str, Any]:
    mcp = request.app.state.mcp
    return {
        "status": "ok",
        "backend": "fastapi",
        "mcp_connected": mcp.connected,
        "mcp_server": mcp.server_info,
    }


@router.post("/stt/transcribe")
async def transcribe_stt(body: SttTranscribeBody, request: Request) -> Dict[str, Any]:
    wav_bytes = base64.b64decode(body.wav_base64)
    return request.app.state.speech.transcribe_wav_bytes(wav_bytes, language=body.language)


@router.post("/tts/synthesize")
async def synthesize_tts(body: TtsSynthesizeBody, request: Request) -> Dict[str, Any]:
    tts = request.app.state.tts
    prev_speed = tts.speed
    if body.speed is not None:
        tts.speed = max(0.5, min(2.0, float(body.speed)))
    try:
        res = tts.synthesize_wav(
            text=body.text,
            voice_id=body.voice_id,
            response_language=body.response_language,
        )
    except Exception as exc:
        return {"ok": False, "reason": str(exc)}
    finally:
        tts.speed = prev_speed

    if not res.get("ok"):
        return res
    wav_bytes = res.pop("wav_bytes", b"")
    mp3_bytes = res.pop("mp3_bytes", b"")
    if wav_bytes:
        res["wav_base64"] = base64.b64encode(wav_bytes).decode("ascii")
        res["audio_format"] = "wav"
    elif mp3_bytes:
        # Edge TTS returns MP3 when ffmpeg/pydub not available
        res["wav_base64"] = base64.b64encode(mp3_bytes).decode("ascii")
        res["audio_format"] = "mp3"
    else:
        res["wav_base64"] = ""
        res["audio_format"] = "none"
    return res


@router.get("/mcp/status")
async def mcp_status(request: Request) -> Dict[str, Any]:
    mcp = request.app.state.mcp
    tools = await mcp.list_tools()
    resources = await mcp.list_resources()
    prompts = await mcp.list_prompts()
    with get_db() as conn:
        logs = [
            dict(r)
            for r in conn.execute(
                "SELECT id, tool_name, arguments_json, result_json, error, duration_ms, status, created_at "
                "FROM mcp_tool_logs ORDER BY id DESC LIMIT 40"
            ).fetchall()
        ]
    return {
        "connected": mcp.connected,
        "transport": "stdio",
        "server": mcp.server_info,
        "tools": tools,
        "resources": resources,
        "prompts": prompts,
        "history": logs,
    }


@router.post("/mcp/tools/{tool_name}/toggle")
async def toggle_mcp_tool(tool_name: str, body: ToolToggleBody, request: Request) -> Dict[str, Any]:
    return await request.app.state.mcp.set_tool_enabled(tool_name, body.enabled)


@router.post("/mcp/tools/{tool_name}/execute")
async def execute_mcp_tool(tool_name: str, body: ToolCallBody, request: Request) -> Dict[str, Any]:
    return await request.app.state.mcp.call_tool(tool_name, body.arguments)


@router.get("/mcp/resources/read")
async def read_mcp_resource(uri: str, request: Request) -> Dict[str, Any]:
    return await request.app.state.mcp.read_resource(uri)


@router.get("/models/status")
async def models_status(request: Request) -> Dict[str, Any]:
    llm_status = await request.app.state.llm.check_status()
    stt_status = request.app.state.speech.get_status()
    tts_status = request.app.state.tts.get_status()
    sys_info = await request.app.state.mcp.call_tool("get_system_information", {})
    return {
        "llm": llm_status,
        "stt": stt_status,
        "tts": tts_status,
        "system": sys_info.get("result", {}),
    }


@router.post("/models/select")
async def select_model(body: ModelSelectBody, request: Request) -> Dict[str, Any]:
    llm = request.app.state.llm
    llm.active_model = body.model
    if body.system_prompt is not None:
        llm.system_prompt = body.system_prompt
    return {"active_model": llm.active_model, "system_prompt": llm.system_prompt}


@router.post("/models/test-tools")
async def test_tool_calling(request: Request, model: str | None = None) -> Dict[str, Any]:
    return await request.app.state.llm.test_tool_calling_compatibility(model)


@router.post("/voices/config")
async def configure_voice(body: VoiceConfigBody, request: Request) -> Dict[str, Any]:
    tts = request.app.state.tts
    if body.voice_id is not None:
        tts.active_voice_id = body.voice_id
    if body.speed is not None:
        tts.speed = max(0.5, min(2.0, float(body.speed)))
    return tts.get_status()


@router.get("/data/overview")
async def data_overview() -> Dict[str, Any]:
    with get_db() as conn:
        memories = [dict(r) for r in conn.execute("SELECT * FROM memories ORDER BY updated_at DESC").fetchall()]
        notes = []
        for r in conn.execute("SELECT * FROM notes ORDER BY updated_at DESC").fetchall():
            item = dict(r)
            item["tags"] = json.loads(item.pop("tags_json", "[]") or "[]")
            notes.append(item)
        todos = [dict(r) for r in conn.execute("SELECT * FROM todos ORDER BY updated_at DESC").fetchall()]
        conversations = [
            dict(r) for r in conn.execute("SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 30").fetchall()
        ]
    return {
        "memories": memories,
        "notes": notes,
        "todos": todos,
        "conversations": conversations,
    }


@router.delete("/data/memories/{memory_id}")
async def delete_memory_route(memory_id: int, confirmed: bool = False, request: Request = None) -> Dict[str, Any]:
    if not confirmed:
        raise HTTPException(status_code=400, detail="Explicit confirmation required.")
    return await request.app.state.mcp.call_tool("delete_memory", {"memory_id": memory_id, "confirmed": True})


@router.delete("/data/notes/{note_id}")
async def delete_note_route(note_id: int, confirmed: bool = False, request: Request = None) -> Dict[str, Any]:
    if not confirmed:
        raise HTTPException(status_code=400, detail="Explicit confirmation required.")
    return await request.app.state.mcp.call_tool("delete_note", {"note_id": note_id, "confirmed": True})
