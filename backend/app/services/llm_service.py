"""Local Ollama LLM service with streaming, tool calling, and compatibility benchmarking."""

from __future__ import annotations

import json
import time
from typing import Any, AsyncIterator, Callable, Dict, List, Optional

import httpx

from app.config.settings import settings


class OllamaLLMService:
    """Async Ollama client designed for 8GB CPU-only machines (single active model)."""

    def __init__(self) -> None:
        self.base_url = settings.ollama_url.rstrip("/")
        self.active_model = settings.default_llm_model
        self.system_prompt = (
            "You are LocalVox, a helpful, concise local voice assistant. "
            "Respond naturally for spoken audio without markdown clutter. "
            "Only call tools when local memory, notes, files, system stats, or calculations are needed."
        )

    async def check_status(self) -> Dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                resp = await client.get(f"{self.base_url}/api/tags")
                resp.raise_for_status()
                data = resp.json()
                models = [
                    {
                        "name": m.get("name"),
                        "size_bytes": m.get("size", 0),
                        "modified_at": m.get("modified_at"),
                        "family": m.get("details", {}).get("family"),
                        "parameter_size": m.get("details", {}).get("parameter_size"),
                        "quantization": m.get("details", {}).get("quantization_level"),
                    }
                    for m in data.get("models", [])
                ]
                return {
                    "reachable": True,
                    "url": self.base_url,
                    "active_model": self.active_model,
                    "models": models,
                }
        except Exception as exc:
            return {
                "reachable": False,
                "url": self.base_url,
                "active_model": self.active_model,
                "models": [],
                "error": str(exc),
            }

    async def test_tool_calling_compatibility(self, model_name: Optional[str] = None) -> Dict[str, Any]:
        target = model_name or self.active_model
        start = time.perf_counter()
        test_tools = [
            {
                "type": "function",
                "function": {
                    "name": "get_current_date_time",
                    "description": "Get current local date and time.",
                    "parameters": {"type": "object", "properties": {}},
                },
            }
        ]
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    f"{self.base_url}/api/chat",
                    json={
                        "model": target,
                        "stream": False,
                        "messages": [
                            {"role": "user", "content": "What is the current local date and time? Use the tool."}
                        ],
                        "tools": test_tools,
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                msg = data.get("message", {})
                tool_calls = msg.get("tool_calls", [])
                elapsed = (time.perf_counter() - start) * 1000.0
                return {
                    "model": target,
                    "native_tool_calling": len(tool_calls) > 0,
                    "tool_calls": tool_calls,
                    "fallback_recommended": len(tool_calls) == 0,
                    "latency_ms": round(elapsed, 1),
                }
        except Exception as exc:
            return {
                "model": target,
                "native_tool_calling": False,
                "fallback_recommended": True,
                "error": str(exc),
                "latency_ms": round((time.perf_counter() - start) * 1000.0, 1),
            }

    async def chat_stream(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        model: Optional[str] = None,
        cancel_check: Optional[Callable[[], bool]] = None,
    ) -> AsyncIterator[Dict[str, Any]]:
        target = model or self.active_model
        ollama_tools = None
        if tools:
            ollama_tools = [
                {
                    "type": "function",
                    "function": {
                        "name": t["name"],
                        "description": t["description"],
                        "parameters": t["inputSchema"],
                    },
                }
                for t in tools
                if t.get("enabled", True)
            ]

        payload: Dict[str, Any] = {
            "model": target,
            "messages": messages,
            "stream": True,
            "options": {"temperature": 0.4, "num_ctx": 4096},
        }
        if ollama_tools:
            payload["tools"] = ollama_tools

        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream("POST", f"{self.base_url}/api/chat", json=payload) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if cancel_check and cancel_check():
                        break
                    if not line.strip():
                        continue
                    chunk = json.loads(line)
                    yield chunk
