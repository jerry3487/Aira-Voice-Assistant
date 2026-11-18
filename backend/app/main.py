"""FastAPI entry point for LocalVox MCP local AI voice backend."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.config.settings import settings
from app.database.sqlite import ensure_db_initialized
from app.services.conversation_service import ConversationService
from app.services.llm_service import OllamaLLMService
from app.services.mcp_client import LocalMcpClient
from app.services.memory_service import MemoryService
from app.services.speech_service import SpeechService
from app.services.tts_service import TTSService
from app.websocket.voice_ws import ws_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_db_initialized()
    mcp_client = LocalMcpClient()
    await mcp_client.start()

    llm_service = OllamaLLMService()
    speech_service = SpeechService()
    tts_service = TTSService()
    memory_service = MemoryService()
    conversation_service = ConversationService(mcp_client, llm_service, memory_service)

    app.state.mcp = mcp_client
    app.state.llm = llm_service
    app.state.speech = speech_service
    app.state.tts = tts_service
    app.state.memory = memory_service
    app.state.conversation = conversation_service
    try:
        yield
    finally:
        await mcp_client.stop()


import os

cors_raw = os.environ.get("LOCALVOX_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:7860,http://127.0.0.1:7860")
cors_origins = [o.strip() for o in cors_raw.split(",") if o.strip()]

app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials="*" not in cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
app.include_router(ws_router)
