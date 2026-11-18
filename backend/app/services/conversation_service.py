"""Conversation orchestration service implementing state machine, MCP tool loop, and cancellation."""

from __future__ import annotations

import time
from typing import Any, Awaitable, Callable, Dict, List, Optional

from app.config.settings import settings
from app.models.schemas import AssistantTurnResult, ConversationState, ToolCallRecord, TurnMetrics
from app.services.llm_service import OllamaLLMService
from app.services.mcp_client import LocalMcpClient
from app.services.memory_service import MemoryService


StateCallback = Callable[[ConversationState, Dict[str, Any]], Awaitable[None]]


class ConversationService:
    """Coordinates LLM reasoning, bounded MCP tool execution, and turn cancellation."""

    def __init__(
        self,
        mcp_client: LocalMcpClient,
        llm_service: OllamaLLMService,
        memory_service: MemoryService,
    ) -> None:
        self.mcp = mcp_client
        self.llm = llm_service
        self.memory = memory_service

    async def process_text_turn(
        self,
        conversation_id: str,
        user_text: str,
        detected_language: str = "en",
        response_language: str = "en",
        on_state: Optional[StateCallback] = None,
        on_token: Optional[Callable[[str], Awaitable[None]]] = None,
        cancel_flag: Optional[Callable[[], bool]] = None,
    ) -> AssistantTurnResult:
        turn_start = time.perf_counter()
        metrics = TurnMetrics()
        tool_records: List[ToolCallRecord] = []

        self.memory.append_message(conversation_id, "user", user_text, language=detected_language)

        if on_state:
            await on_state(ConversationState.THINKING, {"conversation_id": conversation_id})

        history = self.memory.get_recent_messages(conversation_id, limit=10)
        memories = self.memory.get_relevant_memories(user_text, limit=5)
        tools = await self.mcp.list_tools()

        mem_context = ""
        if memories:
            mem_lines = [f"- {m['key']}: {m['content']}" for m in memories]
            mem_context = "\nRelevant saved user memories:\n" + "\n".join(mem_lines)

        system_msg = (
            f"{self.llm.system_prompt}\n"
            f"Respond in language code '{response_language}'.{mem_context}"
        )
        messages: List[Dict[str, Any]] = [{"role": "system", "content": system_msg}]
        for h in history:
            messages.append({"role": h["role"], "content": h["content"]})

        final_text = ""
        for step in range(settings.max_tool_calls_per_turn + 1):
            if cancel_flag and cancel_flag():
                break

            llm_start = time.perf_counter()
            first_token_captured = False
            step_text_parts: List[str] = []
            pending_tool_calls: List[Dict[str, Any]] = []

            async for chunk in self.llm.chat_stream(
                messages=messages,
                tools=tools if step < settings.max_tool_calls_per_turn else None,
                cancel_check=cancel_flag,
            ):
                if cancel_flag and cancel_flag():
                    break
                msg = chunk.get("message", {})
                delta = msg.get("content", "")
                if delta:
                    if not first_token_captured:
                        metrics.llm_first_token_ms = (time.perf_counter() - llm_start) * 1000.0
                        first_token_captured = True
                    step_text_parts.append(delta)
                    if on_token:
                        await on_token(delta)
                if msg.get("tool_calls"):
                    pending_tool_calls.extend(msg["tool_calls"])

            metrics.llm_total_ms += (time.perf_counter() - llm_start) * 1000.0
            step_text = "".join(step_text_parts).strip()

            if not pending_tool_calls:
                final_text = step_text
                break

            messages.append(
                {
                    "role": "assistant",
                    "content": step_text,
                    "tool_calls": pending_tool_calls,
                }
            )

            for call in pending_tool_calls:
                if cancel_flag and cancel_flag():
                    break
                fn = call.get("function", {})
                t_name = fn.get("name", "")
                t_args = fn.get("arguments") or {}

                if on_state:
                    await on_state(
                        ConversationState.TOOL_EXECUTING,
                        {"tool": t_name, "arguments": t_args},
                    )

                t_start = time.perf_counter()
                outcome = await self.mcp.call_tool(t_name, t_args)
                t_dur = (time.perf_counter() - t_start) * 1000.0
                metrics.mcp_tool_ms += t_dur
                metrics.tool_calls_count += 1

                tool_records.append(
                    ToolCallRecord(
                        tool_name=t_name,
                        arguments=t_args,
                        result=outcome.get("result"),
                        error=outcome.get("error"),
                        duration_ms=t_dur,
                        status="success" if outcome.get("ok") else "error",
                    )
                )
                messages.append(
                    {
                        "role": "tool",
                        "content": str(outcome.get("result") or outcome.get("error") or ""),
                    }
                )

            if on_state:
                await on_state(ConversationState.THINKING, {"conversation_id": conversation_id})

        metrics.total_ms = (time.perf_counter() - turn_start) * 1000.0
        self.memory.append_message(
            conversation_id,
            "assistant",
            final_text,
            language=response_language,
            tool_calls=[t.__dict__ for t in tool_records],
            metrics=metrics.to_dict(),
        )

        return AssistantTurnResult(
            conversation_id=conversation_id,
            user_text=user_text,
            assistant_text=final_text,
            detected_language=detected_language,
            response_language=response_language,
            tool_calls=tool_records,
            metrics=metrics,
            engine_mode="ollama",
        )
