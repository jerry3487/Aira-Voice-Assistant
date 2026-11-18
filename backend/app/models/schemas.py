"""Data structures and conversation state enums for LocalVox MCP."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class ConversationState(str, Enum):
    IDLE = "IDLE"
    LISTENING = "LISTENING"
    TRANSCRIBING = "TRANSCRIBING"
    THINKING = "THINKING"
    TOOL_EXECUTING = "TOOL_EXECUTING"
    SPEAKING = "SPEAKING"
    INTERRUPTED = "INTERRUPTED"
    ERROR = "ERROR"


@dataclass
class TurnMetrics:
    stt_ms: float = 0.0
    llm_first_token_ms: float = 0.0
    llm_total_ms: float = 0.0
    mcp_tool_ms: float = 0.0
    tts_ms: float = 0.0
    total_ms: float = 0.0
    tool_calls_count: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "stt_ms": round(self.stt_ms, 1),
            "llm_first_token_ms": round(self.llm_first_token_ms, 1),
            "llm_total_ms": round(self.llm_total_ms, 1),
            "mcp_tool_ms": round(self.mcp_tool_ms, 1),
            "tts_ms": round(self.tts_ms, 1),
            "total_ms": round(self.total_ms, 1),
            "tool_calls_count": self.tool_calls_count,
        }


@dataclass
class ToolCallRecord:
    tool_name: str
    arguments: Dict[str, Any]
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    duration_ms: float = 0.0
    status: str = "success"
    requires_confirmation: bool = False


@dataclass
class AssistantTurnResult:
    conversation_id: str
    user_text: str
    assistant_text: str
    detected_language: str
    response_language: str
    tool_calls: List[ToolCallRecord] = field(default_factory=list)
    metrics: TurnMetrics = field(default_factory=TurnMetrics)
    engine_mode: str = "ollama"
