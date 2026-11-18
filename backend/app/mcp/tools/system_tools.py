"""Read-only local system diagnostic MCP tools (stdlib + optional psutil)."""

from __future__ import annotations

import os
import platform
import shutil
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, List

from app.config.settings import settings


def _read_proc_meminfo() -> Dict[str, int]:
    info: Dict[str, int] = {}
    meminfo = Path("/proc/meminfo")
    if meminfo.exists():
        for line in meminfo.read_text(encoding="utf-8", errors="ignore").splitlines():
            if ":" in line:
                key, val = line.split(":", 1)
                parts = val.strip().split()
                if parts and parts[0].isdigit():
                    info[key] = int(parts[0])  # in kB
    return info


def get_system_information() -> Dict[str, Any]:
    uname = platform.uname()
    cpu_count = os.cpu_count() or 1
    mem = get_memory_usage()
    disk = get_disk_usage()
    return {
        "hostname": uname.node,
        "os": uname.system,
        "release": uname.release,
        "architecture": uname.machine,
        "python_version": platform.python_version(),
        "cpu_cores": cpu_count,
        "memory": mem,
        "disk": disk,
    }


def get_cpu_usage() -> Dict[str, Any]:
    try:
        import psutil  # type: ignore

        pct = psutil.cpu_percent(interval=0.15)
        per_core = psutil.cpu_percent(interval=0.05, percpu=True)
        load1, load5, load15 = os.getloadavg() if hasattr(os, "getloadavg") else (0.0, 0.0, 0.0)
        return {
            "cpu_percent": round(pct, 1),
            "per_core_percent": [round(x, 1) for x in per_core],
            "load_average_1m_5m_15m": [round(load1, 2), round(load5, 2), round(load15, 2)],
            "cpu_cores": os.cpu_count() or 1,
        }
    except ImportError:
        stat_path = Path("/proc/stat")
        load1, load5, load15 = os.getloadavg() if hasattr(os, "getloadavg") else (0.0, 0.0, 0.0)
        cpu_pct = 0.0
        if stat_path.exists():
            def _sample() -> tuple[int, int]:
                first = stat_path.read_text().splitlines()[0].split()[1:]
                nums = [int(x) for x in first]
                idle = nums[3] + (nums[4] if len(nums) > 4 else 0)
                return idle, sum(nums)

            idle1, total1 = _sample()
            time.sleep(0.12)
            idle2, total2 = _sample()
            d_total = max(1, total2 - total1)
            d_idle = max(0, idle2 - idle1)
            cpu_pct = round(100.0 * (1.0 - (d_idle / d_total)), 1)
        return {
            "cpu_percent": cpu_pct,
            "load_average_1m_5m_15m": [round(load1, 2), round(load5, 2), round(load15, 2)],
            "cpu_cores": os.cpu_count() or 1,
        }


def get_memory_usage() -> Dict[str, Any]:
    try:
        import psutil  # type: ignore

        vm = psutil.virtual_memory()
        return {
            "total_mb": round(vm.total / (1024 * 1024), 1),
            "available_mb": round(vm.available / (1024 * 1024), 1),
            "used_mb": round(vm.used / (1024 * 1024), 1),
            "percent_used": round(vm.percent, 1),
        }
    except ImportError:
        info = _read_proc_meminfo()
        total_kb = info.get("MemTotal", 0)
        avail_kb = info.get("MemAvailable", info.get("MemFree", 0))
        used_kb = max(0, total_kb - avail_kb)
        pct = round((used_kb / total_kb) * 100.0, 1) if total_kb else 0.0
        return {
            "total_mb": round(total_kb / 1024.0, 1),
            "available_mb": round(avail_kb / 1024.0, 1),
            "used_mb": round(used_kb / 1024.0, 1),
            "percent_used": pct,
        }


def get_disk_usage(path: str = ".") -> Dict[str, Any]:
    target = settings.approved_dirs[0] if path in (".", "", None) else Path(path)
    if not target.exists():
        target = settings.approved_dirs[0]
    usage = shutil.disk_usage(str(target))
    pct = round((usage.used / usage.total) * 100.0, 1) if usage.total else 0.0
    return {
        "path": str(target),
        "total_gb": round(usage.total / (1024**3), 2),
        "used_gb": round(usage.used / (1024**3), 2),
        "free_gb": round(usage.free / (1024**3), 2),
        "percent_used": pct,
    }


def get_running_processes(limit: int = 12) -> Dict[str, Any]:
    limit = max(1, min(30, int(limit)))
    procs: List[Dict[str, Any]] = []
    try:
        import psutil  # type: ignore

        for proc in psutil.process_iter(["pid", "name", "memory_percent", "status"]):
            try:
                info = proc.info
                procs.append(
                    {
                        "pid": info["pid"],
                        "name": info["name"],
                        "memory_percent": round(info.get("memory_percent") or 0.0, 2),
                        "status": info.get("status") or "unknown",
                    }
                )
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        procs.sort(key=lambda p: p["memory_percent"], reverse=True)
        return {"count": len(procs[:limit]), "processes": procs[:limit]}
    except ImportError:
        proc_dir = Path("/proc")
        if proc_dir.exists():
            for entry in proc_dir.iterdir():
                if not entry.name.isdigit():
                    continue
                comm_file = entry / "comm"
                statm_file = entry / "statm"
                try:
                    name = comm_file.read_text(encoding="utf-8", errors="ignore").strip()
                    rss_pages = int(statm_file.read_text().split()[1]) if statm_file.exists() else 0
                    rss_mb = round((rss_pages * os.sysconf("SC_PAGE_SIZE")) / (1024 * 1024), 2)
                    procs.append({"pid": int(entry.name), "name": name, "rss_mb": rss_mb})
                except Exception:
                    continue
        procs.sort(key=lambda p: p.get("rss_mb", 0), reverse=True)
        return {"count": len(procs[:limit]), "processes": procs[:limit]}


def get_backend_status() -> Dict[str, Any]:
    return {
        "app_name": settings.app_name,
        "version": settings.app_version,
        "db_path": str(settings.db_path),
        "db_exists": settings.db_path.exists(),
        "approved_directories": [str(d) for d in settings.approved_dirs],
        "max_tool_calls_per_turn": settings.max_tool_calls_per_turn,
        "tool_timeout_seconds": settings.tool_timeout_seconds,
    }


def get_model_status() -> Dict[str, Any]:
    ollama_reachable = False
    installed_models: List[str] = []
    try:
        req = urllib.request.Request(f"{settings.ollama_url}/api/tags", method="GET")
        with urllib.request.urlopen(req, timeout=1.2) as resp:
            import json

            data = json.loads(resp.read().decode("utf-8"))
            ollama_reachable = True
            installed_models = [m.get("name", "") for m in data.get("models", []) if m.get("name")]
    except Exception:
        ollama_reachable = False

    voices_found: List[str] = []
    if settings.voices_dir.exists():
        voices_found = [p.name for p in settings.voices_dir.glob("*.onnx")]

    return {
        "ollama_url": settings.ollama_url,
        "ollama_reachable": ollama_reachable,
        "installed_llm_models": installed_models,
        "configured_llm_model": settings.default_llm_model,
        "stt_model": f"faster-whisper-{settings.stt_model_size} ({settings.stt_compute_type})",
        "tts_engine": settings.tts_engine,
        "installed_piper_voices": voices_found,
    }


TOOL_SPECS: List[Dict[str, Any]] = [
    {
        "name": "get_system_information",
        "category": "system",
        "description": "Inspect local OS, architecture, CPU cores, memory, and disk capacity.",
        "inputSchema": {"type": "object", "properties": {}},
        "handler": get_system_information,
    },
    {
        "name": "get_cpu_usage",
        "category": "system",
        "description": "Measure current local CPU utilization and load averages.",
        "inputSchema": {"type": "object", "properties": {}},
        "handler": get_cpu_usage,
    },
    {
        "name": "get_memory_usage",
        "category": "system",
        "description": "Measure local RAM total, used, available, and percentage.",
        "inputSchema": {"type": "object", "properties": {}},
        "handler": get_memory_usage,
    },
    {
        "name": "get_disk_usage",
        "category": "system",
        "description": "Inspect local filesystem disk capacity and free space.",
        "inputSchema": {
            "type": "object",
            "properties": {"path": {"type": "string", "default": "."}},
        },
        "handler": get_disk_usage,
    },
    {
        "name": "get_running_processes",
        "category": "system",
        "description": "List top local running processes sorted by memory usage (read-only).",
        "inputSchema": {
            "type": "object",
            "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 30, "default": 12}},
        },
        "handler": get_running_processes,
    },
    {
        "name": "get_backend_status",
        "category": "system",
        "description": "Inspect LocalVox backend configuration, database status, and approved directories.",
        "inputSchema": {"type": "object", "properties": {}},
        "handler": get_backend_status,
    },
    {
        "name": "get_model_status",
        "category": "system",
        "description": "Check local Ollama reachability, installed LLMs, STT config, and Piper voices.",
        "inputSchema": {"type": "object", "properties": {}},
        "handler": get_model_status,
    },
]
