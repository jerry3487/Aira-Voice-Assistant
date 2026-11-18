"""Reusable MCP prompt templates for Aira voice assistant."""

from __future__ import annotations

from typing import Any, Dict, List


PROMPT_SPECS: List[Dict[str, Any]] = [
    {
        "name": "general_conversation",
        "description": "Natural, concise spoken assistant prompt optimized for voice playback.",
        "arguments": [
            {"name": "response_language", "description": "Target spoken response language", "required": False}
        ],
        "template": (
            "You are Aira, a private local AI voice assistant running completely on the user's machine. "
            "Keep answers natural, concise, and easy to understand when spoken aloud. Avoid markdown tables or long bullet lists unless asked. "
            "Respond in {response_language}. Only invoke an MCP tool when external local data or action is genuinely required."
        ),
    },
    {
        "name": "technical_assistance",
        "description": "Focused engineering assistant prompt for code, architecture, and debugging.",
        "arguments": [
            {"name": "topic", "description": "Engineering domain or problem", "required": False}
        ],
        "template": (
            "Provide clear, accurate engineering guidance on {topic}. "
            "Use local file tools (`search_code`, `read_text_file`, `inspect_project_structure`) only when inspecting workspace code is needed."
        ),
    },
    {
        "name": "local_file_analysis",
        "description": "Safe workspace file inspection prompt respecting approved directories.",
        "arguments": [
            {"name": "directory", "description": "Relative directory inside approved workspace", "required": False}
        ],
        "template": (
            "Analyze local files under '{directory}' using `list_project_files`, `search_code`, and `read_text_file`. "
            "Never attempt to read credentials, .env files, or paths outside approved directories."
        ),
    },
    {
        "name": "memory_aware_response",
        "description": "Prompt instructing the assistant to check and maintain persistent SQLite memories.",
        "arguments": [
            {"name": "user_query", "description": "Current user request", "required": True}
        ],
        "template": (
            "Before answering '{user_query}', consult relevant saved memories via `search_memory` if context is missing. "
            "Only call `save_memory` for durable user preferences, facts, or ongoing project details—not casual chit-chat."
        ),
    },
    {
        "name": "system_diagnostics",
        "description": "Prompt for diagnosing local CPU, RAM, disk, and model availability.",
        "arguments": [],
        "template": (
            "Diagnose local machine health using `get_system_information`, `get_cpu_usage`, `get_memory_usage`, "
            "`get_disk_usage`, and `get_model_status`. Report exact measured numbers clearly."
        ),
    },
]


def list_prompts() -> List[Dict[str, Any]]:
    return [
        {
            "name": p["name"],
            "description": p["description"],
            "arguments": p["arguments"],
        }
        for p in PROMPT_SPECS
    ]


def get_prompt(name: str, arguments: Dict[str, Any] | None = None) -> Dict[str, Any]:
    args = arguments or {}
    for p in PROMPT_SPECS:
        if p["name"] == name:
            safe_args = {
                "response_language": args.get("response_language", "English"),
                "topic": args.get("topic", "software engineering"),
                "directory": args.get("directory", "."),
                "user_query": args.get("user_query", ""),
            }
            text = p["template"].format(**safe_args)
            return {
                "description": p["description"],
                "messages": [{"role": "user", "content": {"type": "text", "text": text}}],
            }
    raise ValueError(f"Prompt '{name}' not found.")
