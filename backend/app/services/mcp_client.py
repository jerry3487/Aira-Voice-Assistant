"""Local async MCP stdio client connecting FastAPI backend to the custom Python MCP server."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.config.settings import settings


class LocalMcpClient:
    """Manages a persistent local MCP server subprocess over stdio."""

    def __init__(self) -> None:
        self._proc: Optional[asyncio.subprocess.Process] = None
        self._req_id: int = 0
        self._lock = asyncio.Lock()
        self.connected: bool = False
        self.server_info: Dict[str, Any] = {}

    async def start(self) -> None:
        if self._proc and self._proc.returncode is None:
            return
        server_script = Path(__file__).resolve().parents[1] / "mcp" / "server.py"
        self._proc = await asyncio.create_subprocess_exec(
            sys.executable,
            str(server_script),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        init_res = await self.request(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "clientInfo": {"name": "localvox-fastapi-client", "version": "1.0.0"},
                "capabilities": {},
            },
        )
        self.server_info = init_res.get("serverInfo", {})
        await self.notify("notifications/initialized", {})
        self.connected = True

    async def stop(self) -> None:
        if self._proc and self._proc.returncode is None:
            self._proc.terminate()
            try:
                await asyncio.wait_for(self._proc.wait(), timeout=2.0)
            except asyncio.TimeoutError:
                self._proc.kill()
        self.connected = False

    async def notify(self, method: str, params: Dict[str, Any]) -> None:
        if not self._proc or not self._proc.stdin:
            return
        payload = json.dumps({"jsonrpc": "2.0", "method": method, "params": params}) + "\n"
        self._proc.stdin.write(payload.encode("utf-8"))
        await self._proc.stdin.drain()

    async def request(
        self, method: str, params: Dict[str, Any] | None = None, timeout: float | None = None
    ) -> Dict[str, Any]:
        async with self._lock:
            if not self._proc or self._proc.returncode is not None:
                await self.start()
            assert self._proc and self._proc.stdin and self._proc.stdout

            self._req_id += 1
            rid = self._req_id
            payload = (
                json.dumps({"jsonrpc": "2.0", "id": rid, "method": method, "params": params or {}})
                + "\n"
            )
            self._proc.stdin.write(payload.encode("utf-8"))
            await self._proc.stdin.drain()

            wait_s = timeout or settings.tool_timeout_seconds
            line = await asyncio.wait_for(self._proc.stdout.readline(), timeout=wait_s)
            if not line:
                raise RuntimeError("MCP server closed stdout unexpectedly.")
            resp = json.loads(line.decode("utf-8"))
            if "error" in resp:
                raise RuntimeError(resp["error"].get("message", "Unknown MCP error"))
            return resp.get("result", {})

    async def list_tools(self) -> List[Dict[str, Any]]:
        res = await self.request("tools/list")
        return res.get("tools", [])

    async def call_tool(self, name: str, arguments: Dict[str, Any] | None = None) -> Dict[str, Any]:
        res = await self.request("tools/call", {"name": name, "arguments": arguments or {}})
        content = res.get("content", [])
        if content and content[0].get("type") == "text":
            return json.loads(content[0]["text"])
        return {"ok": False, "error": "Malformed MCP tool response"}

    async def set_tool_enabled(self, name: str, enabled: bool) -> Dict[str, Any]:
        return await self.request("tools/set_enabled", {"name": name, "enabled": enabled})

    async def list_resources(self) -> List[Dict[str, Any]]:
        res = await self.request("resources/list")
        return res.get("resources", [])

    async def read_resource(self, uri: str) -> Dict[str, Any]:
        res = await self.request("resources/read", {"uri": uri})
        contents = res.get("contents", [])
        return contents[0] if contents else {}

    async def list_prompts(self) -> List[Dict[str, Any]]:
        res = await self.request("prompts/list")
        return res.get("prompts", [])

    async def get_prompt(self, name: str, arguments: Dict[str, Any] | None = None) -> Dict[str, Any]:
        return await self.request("prompts/get", {"name": name, "arguments": arguments or {}})
