"""Hardware & model benchmark utility for 8GB RAM CPU-only machines."""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.mcp.tools.system_tools import get_cpu_usage, get_memory_usage, get_model_status, get_system_information


def run_benchmark() -> dict:
    t0 = time.perf_counter()
    sys_info = get_system_information()
    cpu = get_cpu_usage()
    mem = get_memory_usage()
    models = get_model_status()

    # Check faster-whisper availability
    stt_ready = False
    try:
        import faster_whisper  # type: ignore # noqa: F401

        stt_ready = True
    except ImportError:
        pass

    # Check piper availability
    tts_ready = False
    try:
        import piper  # type: ignore # noqa: F401

        tts_ready = True
    except ImportError:
        pass

    report = {
        "system": sys_info,
        "cpu": cpu,
        "memory": mem,
        "models": models,
        "dependencies": {
            "faster_whisper": stt_ready,
            "piper_tts": tts_ready,
        },
        "benchmark_elapsed_ms": round((time.perf_counter() - t0) * 1000.0, 2),
        "recommendations_8gb_ram": {
            "llm": "qwen3:1.7b (Q4_K_M ~1.4 GB RAM) or gemma3:1b (~1.0 GB RAM)",
            "stt": "faster-whisper base (CPU INT8 ~220 MB RAM)",
            "tts": "piper medium voice (~80 MB RAM)",
            "vad": "silero-vad (~15 MB RAM)",
        },
    }
    return report


if __name__ == "__main__":
    print(json.dumps(run_benchmark(), indent=2))
