"""Custom LocalVox MCP Server (stdio JSON-RPC 2.0 + official MCP Python SDK support).

Run directly over stdio:
    python3 -m app.mcp.server
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

# Ensure `backend/` is on sys.path when invoked as a script
BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.database.sqlite import ensure_db_initialized, get_db, log_mcp_execution, utc_now_iso
from app.mcp.config import MCP_SERVER_NAME, MCP_SERVER_VERSION, SENSITIVE_TOOLS
from app.mcp.prompts.assistant_prompts import get_prompt, list_prompts
from app.mcp.resources.local_resources import list_resources, read_resource
from app.mcp.tools import (
    file_tools,
    memory_tools,
    notes_tools,
    system_tools,
    utility_tools,
)

ALL_TOOL_SPECS: List[Dict[str, Any]] = (
    memory_tools.TOOL_SPECS
    + system_tools.TOOL_SPECS
    + file_tools.TOOL_SPECS
    + notes_tools.TOOL_SPECS
    + utility_tools.TOOL_SPECS
)

TOOL_REGISTRY: Dict[str, Dict[str, Any]] = {spec["name"]: spec for spec in ALL_TOOL_SPECS}


def _is_tool_enabled(tool_name: str) -> bool:
    with get_db() as conn:
        row = conn.execute(
            "SELECT enabled FROM mcp_tool_settings WHERE tool_name = ?", (tool_name,)
        ).fetchone()
        if row is None:
            return True
        return bool(row["enabled"])


def list_tools_metadata() -> List[Dict[str, Any]]:
    with get_db() as conn:
        rows = conn.execute("SELECT tool_name, enabled FROM mcp_tool_settings").fetchall()
        enabled_map = {r["tool_name"]: bool(r["enabled"]) for r in rows}

    tools_out: List[Dict[str, Any]] = []
    for spec in ALL_TOOL_SPECS:
        name = spec["name"]
        tools_out.append(
            {
                "name": name,
                "category": spec.get("category", "general"),
                "description": spec["description"],
                "inputSchema": spec["inputSchema"],
                "enabled": enabled_map.get(name, True),
                "requires_confirmation": bool(
                    spec.get("requires_confirmation") or name in SENSITIVE_TOOLS
                ),
            }
        )
    return tools_out


def set_tool_enabled(tool_name: str, enabled: bool) -> Dict[str, Any]:
    if tool_name not in TOOL_REGISTRY:
        raise ValueError(f"Unknown MCP tool: '{tool_name}'.")
    now = utc_now_iso()
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO mcp_tool_settings (tool_name, enabled, requires_confirmation, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(tool_name) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at
            """,
            (
                tool_name,
                1 if enabled else 0,
                1 if tool_name in SENSITIVE_TOOLS else 0,
                now,
            ),
        )
    return {"tool_name": tool_name, "enabled": bool(enabled)}


def execute_tool(tool_name: str, arguments: Dict[str, Any] | None = None) -> Dict[str, Any]:
    start = time.perf_counter()
    args = arguments if isinstance(arguments, dict) else {}

    if tool_name not in TOOL_REGISTRY:
        duration_ms = (time.perf_counter() - start) * 1000.0
        err = f"Unknown MCP tool '{tool_name}'."
        log_mcp_execution(tool_name, args, None, err, duration_ms, "error")
        return {"ok": False, "error": err, "duration_ms": round(duration_ms, 2)}

    if not _is_tool_enabled(tool_name):
        duration_ms = (time.perf_counter() - start) * 1000.0
        err = f"Tool '{tool_name}' is currently disabled by user settings."
        log_mcp_execution(tool_name, args, None, err, duration_ms, "disabled")
        return {"ok": False, "error": err, "duration_ms": round(duration_ms, 2)}

    spec = TOOL_REGISTRY[tool_name]
    handler = spec["handler"]

    # Validate required fields against inputSchema
    required = spec.get("inputSchema", {}).get("required", [])
    for req_key in required:
        if req_key not in args or args[req_key] is None or args[req_key] == "":
            duration_ms = (time.perf_counter() - start) * 1000.0
            err = f"Missing required argument '{req_key}' for tool '{tool_name}'."
            log_mcp_execution(tool_name, args, None, err, duration_ms, "error")
            return {"ok": False, "error": err, "duration_ms": round(duration_ms, 2)}

    # Filter unexpected keys safely based on schema properties
    allowed_props = set(spec.get("inputSchema", {}).get("properties", {}).keys())
    clean_args = {k: v for k, v in args.items() if k in allowed_props}

    try:
        result = handler(**clean_args)
        duration_ms = (time.perf_counter() - start) * 1000.0
        log_mcp_execution(tool_name, clean_args, result, None, duration_ms, "success")
        return {
            "ok": True,
            "tool": tool_name,
            "result": result,
            "duration_ms": round(duration_ms, 2),
        }
    except Exception as exc:
        duration_ms = (time.perf_counter() - start) * 1000.0
        err = f"{type(exc).__name__}: {exc}"
        log_mcp_execution(tool_name, clean_args, None, err, duration_ms, "error")
        return {
            "ok": False,
            "tool": tool_name,
            "error": err,
            "duration_ms": round(duration_ms, 2),
        }


def handle_jsonrpc_message(msg: Dict[str, Any]) -> Dict[str, Any] | None:
    """Process one MCP JSON-RPC 2.0 request/notification."""
    method = msg.get("method")
    req_id = msg.get("id")
    params = msg.get("params") or {}

    # Notifications have no id
    if method == "notifications/initialized":
        return None

    try:
        if method == "initialize":
            result = {
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {"listChanged": True},
                    "resources": {"subscribe": False, "listChanged": False},
                    "prompts": {"listChanged": False},
                },
                "serverInfo": {
                    "name": MCP_SERVER_NAME,
                    "version": MCP_SERVER_VERSION,
                },
            }
        elif method == "ping":
            result = {"pong": True}
        elif method == "tools/list":
            result = {"tools": list_tools_metadata()}
        elif method == "tools/call":
            tool_name = params.get("name", "")
            tool_args = params.get("arguments") or {}
            outcome = execute_tool(tool_name, tool_args)
            is_err = not outcome.get("ok", False)
            result = {
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps(outcome, ensure_ascii=False),
                    }
                ],
                "isError": is_err,
            }
        elif method == "tools/set_enabled":
            result = set_tool_enabled(params.get("name", ""), bool(params.get("enabled", True)))
        elif method == "resources/list":
            result = {"resources": list_resources()}
        elif method == "resources/read":
            uri = params.get("uri", "")
            result = {"contents": [read_resource(uri)]}
        elif method == "prompts/list":
            result = {"prompts": list_prompts()}
        elif method == "prompts/get":
            name = params.get("name", "")
            args = params.get("arguments") or {}
            result = get_prompt(name, args)
        elif method == "db/append_message":
            conv_id = str(params.get("conversation_id") or "default")
            role = str(params.get("role") or "user")
            content = str(params.get("content") or "")
            lang = str(params.get("language") or "en")
            tool_calls = params.get("tool_calls")
            metrics = params.get("metrics")
            now = utc_now_iso()
            with get_db() as conn:
                existing = conn.execute(
                    "SELECT id FROM conversations WHERE id = ?", (conv_id,)
                ).fetchone()
                if not existing:
                    conn.execute(
                        "INSERT INTO conversations (id, title, language, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                        (conv_id, (content[:48] or "Voice Session"), lang, now, now),
                    )
                else:
                    conn.execute(
                        "UPDATE conversations SET updated_at = ? WHERE id = ?", (now, conv_id)
                    )
                cur = conn.execute(
                    """
                    INSERT INTO messages (conversation_id, role, content, language, tool_calls_json, metrics_json, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        conv_id,
                        role,
                        content,
                        lang,
                        json.dumps(tool_calls, ensure_ascii=False) if tool_calls else None,
                        json.dumps(metrics, ensure_ascii=False) if metrics else None,
                        now,
                    ),
                )
                result = {"id": int(cur.lastrowid or 0), "conversation_id": conv_id}
        elif method == "db/list_conversations":
            with get_db() as conn:
                convs = [
                    dict(r)
                    for r in conn.execute(
                        "SELECT id, title, language, created_at, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 30"
                    ).fetchall()
                ]
                logs = [
                    dict(r)
                    for r in conn.execute(
                        "SELECT id, tool_name, arguments_json, result_json, error, duration_ms, status, created_at FROM mcp_tool_logs ORDER BY id DESC LIMIT 40"
                    ).fetchall()
                ]
            result = {"conversations": convs, "logs": logs}
        elif method == "db/delete_conversation":
            conv_id = str(params.get("conversation_id") or "")
            with get_db() as conn:
                conn.execute("DELETE FROM conversations WHERE id = ?", (conv_id,))
            result = {"deleted": conv_id}
        elif method == "db/create_user":
            name = str(params.get("name") or "").strip()
            email = str(params.get("email") or "").strip().lower()
            password_hash = str(params.get("password_hash") or "")
            if not name or not email or not password_hash:
                raise ValueError("Name, email, and password are required.")
            now = utc_now_iso()
            with get_db() as conn:
                existing = conn.execute(
                    "SELECT id FROM users WHERE email = ?", (email,)
                ).fetchone()
                if existing:
                    raise ValueError("An account with this email already exists.")
                cur = conn.execute(
                    "INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
                    (name, email, password_hash, now),
                )
                result = {
                    "id": int(cur.lastrowid or 0),
                    "name": name,
                    "email": email,
                    "created_at": now,
                }
        elif method == "db/get_user_by_email":
            email = str(params.get("email") or "").strip().lower()
            with get_db() as conn:
                row = conn.execute(
                    "SELECT id, name, email, password_hash, created_at FROM users WHERE email = ?",
                    (email,),
                ).fetchone()
            result = {"user": dict(row) if row else None}
        else:
            if req_id is None:
                return None
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32601, "message": f"Method not found: {method}"},
            }

        if req_id is None:
            return None
        return {"jsonrpc": "2.0", "id": req_id, "result": result}
    except Exception as exc:
        if req_id is None:
            return None
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(exc)},
        }


async def run_official_mcp_sdk_stdio() -> bool:
    """Use the official `mcp` Python SDK over stdio when installed."""
    try:
        from mcp.server import Server  # type: ignore
        from mcp.server.stdio import stdio_server  # type: ignore
        from mcp import types as mcp_types  # type: ignore
    except ImportError:
        return False

    server = Server(MCP_SERVER_NAME)

    @server.list_tools()
    async def _list_tools() -> list[mcp_types.Tool]:
        return [
            mcp_types.Tool(
                name=t["name"],
                description=t["description"],
                inputSchema=t["inputSchema"],
            )
            for t in list_tools_metadata()
            if t["enabled"]
        ]

    @server.call_tool()
    async def _call_tool(name: str, arguments: dict | None) -> list[mcp_types.TextContent]:
        outcome = execute_tool(name, arguments or {})
        return [
            mcp_types.TextContent(
                type="text",
                text=json.dumps(outcome, ensure_ascii=False),
            )
        ]

    @server.list_resources()
    async def _list_resources() -> list[mcp_types.Resource]:
        return [
            mcp_types.Resource(
                uri=r["uri"],
                name=r["name"],
                description=r["description"],
                mimeType=r["mimeType"],
            )
            for r in list_resources()
        ]

    @server.read_resource()
    async def _read_resource(uri: Any) -> str:
        content = read_resource(str(uri))
        return content["text"]

    @server.list_prompts()
    async def _list_prompts() -> list[mcp_types.Prompt]:
        return [
            mcp_types.Prompt(
                name=p["name"],
                description=p["description"],
                arguments=[
                    mcp_types.PromptArgument(
                        name=a["name"],
                        description=a.get("description", ""),
                        required=bool(a.get("required", False)),
                    )
                    for a in p.get("arguments", [])
                ],
            )
            for p in list_prompts()
        ]

    @server.get_prompt()
    async def _get_prompt(name: str, arguments: dict | None) -> mcp_types.GetPromptResult:
        res = get_prompt(name, arguments)
        return mcp_types.GetPromptResult(
            description=res["description"],
            messages=[
                mcp_types.PromptMessage(
                    role="user",
                    content=mcp_types.TextContent(
                        type="text", text=res["messages"][0]["content"]["text"]
                    ),
                )
            ],
        )

    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())
    return True


def run_stdlib_stdio_loop() -> None:
    """Line-delimited JSON-RPC 2.0 MCP stdio server using Python stdlib only."""
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError as exc:
            resp = {
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32700, "message": f"Parse error: {exc}"},
            }
            sys.stdout.write(json.dumps(resp) + "\n")
            sys.stdout.flush()
            continue

        resp = handle_jsonrpc_message(msg)
        if resp is not None:
            sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
            sys.stdout.flush()


def main() -> None:
    ensure_db_initialized()
    # Use official MCP SDK when requested with --official-sdk and installed;
    # default stdio JSON-RPC loop guarantees zero-dependency local bridge compatibility
    # while exposing the exact same MCP protocol methods & schema.
    if "--official-sdk" in sys.argv:
        ok = asyncio.run(run_official_mcp_sdk_stdio())
        if ok:
            return
    run_stdlib_stdio_loop()


if __name__ == "__main__":
    main()
