"""Hardware-aware configuration for LocalVox MCP."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import List

try:
    from dotenv import load_dotenv
    PROJECT_ROOT = Path(__file__).resolve().parents[3]
    load_dotenv(PROJECT_ROOT / ".env")
except ImportError:
    PROJECT_ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = Path(os.environ.get("LOCALVOX_DATA_DIR", PROJECT_ROOT / "backend" / "data"))
DB_PATH = Path(os.environ.get("LOCALVOX_DB_PATH", DATA_DIR / "assistant.db"))
VOICES_DIR = Path(os.environ.get("LOCALVOX_VOICES_DIR", PROJECT_ROOT / "backend" / "voices"))


def _parse_approved_dirs() -> List[Path]:
    raw = os.environ.get("LOCALVOX_APPROVED_DIRS", "")
    if raw.strip():
        dirs = [Path(p.strip()).resolve() for p in raw.split(",") if p.strip()]
        return [d for d in dirs if d.exists() and d.is_dir()]
    # Default to safe workspace directories only
    return [PROJECT_ROOT.resolve()]


@dataclass(frozen=True)
class Settings:
    app_name: str = "LocalVox MCP"
    app_version: str = "1.0.0"
    host: str = os.environ.get("LOCALVOX_HOST", "127.0.0.1")
    port: int = int(os.environ.get("LOCALVOX_PORT", "8000"))
    ollama_url: str = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
    default_llm_model: str = os.environ.get("LOCALVOX_LLM_MODEL", "qwen3:1.7b")
    fallback_llm_model: str = os.environ.get("LOCALVOX_FALLBACK_MODEL", "gemma3:1b")
    stt_model_size: str = os.environ.get("LOCALVOX_STT_MODEL", "base")
    stt_compute_type: str = os.environ.get("LOCALVOX_STT_COMPUTE", "int8")
    tts_engine: str = os.environ.get("LOCALVOX_TTS_ENGINE", "piper")
    max_tool_calls_per_turn: int = int(os.environ.get("LOCALVOX_MAX_TOOLS", "4"))
    tool_timeout_seconds: float = float(os.environ.get("LOCALVOX_TOOL_TIMEOUT", "10.0"))
    max_file_read_bytes: int = int(os.environ.get("LOCALVOX_MAX_FILE_BYTES", str(128 * 1024)))
    data_dir: Path = DATA_DIR
    db_path: Path = DB_PATH
    voices_dir: Path = VOICES_DIR
    approved_dirs: List[Path] = field(default_factory=_parse_approved_dirs)


settings = Settings()
