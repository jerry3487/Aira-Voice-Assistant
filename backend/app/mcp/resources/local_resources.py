"""Local MCP resources exposed safely to the assistant and client."""

from __future__ import annotations

import json
from typing import Any, Dict, List

from app.config.settings import settings
from app.mcp.tools.memory_tools import retrieve_conversation_history, search_memory
from app.mcp.tools.system_tools import get_backend_status, get_model_status


SUPPORTED_LANGUAGES: List[Dict[str, Any]] = [
    {"code": "en", "name": "English", "stt_supported": True, "piper_voice_hint": "en_US-lessac-medium"},
    {"code": "ta", "name": "Tamil", "stt_supported": True, "piper_voice_hint": "ta_IN (check installed voices)"},
    {"code": "hi", "name": "Hindi", "stt_supported": True, "piper_voice_hint": "hi_IN-rohan-medium"},
    {"code": "te", "name": "Telugu", "stt_supported": True, "piper_voice_hint": "te_IN-maya-medium"},
    {"code": "ml", "name": "Malayalam", "stt_supported": True, "piper_voice_hint": "ml_IN-arjun-medium"},
    {"code": "kn", "name": "Kannada", "stt_supported": True, "piper_voice_hint": "kn_IN (check installed voices)"},
    {"code": "es", "name": "Spanish", "stt_supported": True, "piper_voice_hint": "es_ES-davefx-medium"},
    {"code": "fr", "name": "French", "stt_supported": True, "piper_voice_hint": "fr_FR-siwis-medium"},
]


def _discover_tts_voices() -> List[Dict[str, Any]]:
    voices: List[Dict[str, Any]] = [
        {"id": "ta-IN-PallaviNeural", "engine": "edge", "language": "ta", "gender": "female", "name": "Tamil - Pallavi (Neural)", "license": "Microsoft Neural", "installed": True},
        {"id": "ta-IN-ValluvarNeural", "engine": "edge", "language": "ta", "gender": "male", "name": "Tamil - Valluvar (Neural)", "license": "Microsoft Neural", "installed": True},
        {"id": "hi-IN-SwaraNeural", "engine": "edge", "language": "hi", "gender": "female", "name": "Hindi - Swara (Neural)", "license": "Microsoft Neural", "installed": True},
        {"id": "hi-IN-MadhurNeural", "engine": "edge", "language": "hi", "gender": "male", "name": "Hindi - Madhur (Neural)", "license": "Microsoft Neural", "installed": True},
        {"id": "te-IN-ShrutiNeural", "engine": "edge", "language": "te", "gender": "female", "name": "Telugu - Shruti (Neural)", "license": "Microsoft Neural", "installed": True},
        {"id": "kn-IN-SapnaNeural", "engine": "edge", "language": "kn", "gender": "female", "name": "Kannada - Sapna (Neural)", "license": "Microsoft Neural", "installed": True},
        {"id": "ml-IN-SobhanaNeural", "engine": "edge", "language": "ml", "gender": "female", "name": "Malayalam - Sobhana (Neural)", "license": "Microsoft Neural", "installed": True},
        {"id": "en-IN-NeerjaNeural", "engine": "edge", "language": "en", "gender": "female", "name": "English (India) - Neerja (Neural)", "license": "Microsoft Neural", "installed": True},
        {"id": "en-US-AriaNeural", "engine": "edge", "language": "en", "gender": "female", "name": "English (US) - Aria (Neural)", "license": "Microsoft Neural", "installed": True},
    ]
    if settings.voices_dir.exists():
        for onnx_file in sorted(settings.voices_dir.glob("*.onnx")):
            stem = onnx_file.stem
            lang = stem.split("_")[0] if "_" in stem else "en"
            meta_json = onnx_file.with_suffix(".onnx.json")
            license_name = "Verify .onnx.json"
            speaker_gender = "neutral"
            if meta_json.exists():
                try:
                    meta = json.loads(meta_json.read_text(encoding="utf-8"))
                    license_name = meta.get("license", license_name)
                    speaker_gender = meta.get("gender", speaker_gender)
                except Exception:
                    pass
            voices.append(
                {
                    "id": stem,
                    "engine": "piper",
                    "language": lang,
                    "gender": speaker_gender,
                    "license": license_name,
                    "installed": True,
                }
            )
    return voices


RESOURCE_SPECS: List[Dict[str, Any]] = [
    {
        "uri": "localvox://conversation/context",
        "name": "Current Conversation Context",
        "description": "Recent messages stored in local SQLite.",
        "mimeType": "application/json",
        "reader": lambda: retrieve_conversation_history(limit=20),
    },
    {
        "uri": "localvox://memory/saved",
        "name": "Saved Long-Term Memories",
        "description": "Relevant facts and preferences persisted across sessions.",
        "mimeType": "application/json",
        "reader": lambda: search_memory(limit=25),
    },
    {
        "uri": "localvox://models/llm",
        "name": "Available Local LLM Models",
        "description": "Ollama status and locally installed quantized LLMs.",
        "mimeType": "application/json",
        "reader": get_model_status,
    },
    {
        "uri": "localvox://models/stt",
        "name": "Installed Speech Recognition Models",
        "description": "faster-whisper CPU INT8 configuration and model tiers.",
        "mimeType": "application/json",
        "reader": lambda: {
            "engine": "faster-whisper",
            "active_size": settings.stt_model_size,
            "compute_type": settings.stt_compute_type,
            "device": "cpu",
            "supported_tiers": ["tiny", "base", "small"],
        },
    },
    {
        "uri": "localvox://voices/tts",
        "name": "Installed TTS Voices",
        "description": "Dynamically discovered local Piper / Kokoro voice models.",
        "mimeType": "application/json",
        "reader": lambda: {
            "engine": settings.tts_engine,
            "voices_dir": str(settings.voices_dir),
            "installed_voices": _discover_tts_voices(),
        },
    },
    {
        "uri": "localvox://config/languages",
        "name": "Supported Languages",
        "description": "Multilingual STT and TTS language support matrix.",
        "mimeType": "application/json",
        "reader": lambda: {"languages": SUPPORTED_LANGUAGES},
    },
    {
        "uri": "localvox://config/safe",
        "name": "Safe Application Configuration",
        "description": "Non-sensitive runtime settings and approved file directories.",
        "mimeType": "application/json",
        "reader": get_backend_status,
    },
]


def list_resources() -> List[Dict[str, Any]]:
    return [
        {
            "uri": r["uri"],
            "name": r["name"],
            "description": r["description"],
            "mimeType": r["mimeType"],
        }
        for r in RESOURCE_SPECS
    ]


def read_resource(uri: str) -> Dict[str, Any]:
    for r in RESOURCE_SPECS:
        if r["uri"] == uri:
            return {
                "uri": r["uri"],
                "mimeType": r["mimeType"],
                "text": json.dumps(r["reader"](), indent=2, ensure_ascii=False),
            }
    raise ValueError(f"Resource '{uri}' not found.")
