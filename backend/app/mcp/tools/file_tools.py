"""Strictly sandboxed local file inspection MCP tools."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Dict, List

from app.config.settings import settings
from app.mcp.config import (
    BLOCKED_EXTENSIONS,
    BLOCKED_FILENAMES,
    BLOCKED_PATH_PARTS,
    validate_safe_path,
)


def _is_entry_allowed(path: Path) -> bool:
    for part in path.parts:
        if part in BLOCKED_PATH_PARTS:
            return False
    name = path.name.lower()
    if name in BLOCKED_FILENAMES or name.startswith(".env."):
        return False
    if "secret" in name or "credential" in name or "password" in name:
        return False
    if path.suffix.lower() in BLOCKED_EXTENSIONS:
        return False
    return True


def search_local_files(query: str, directory: str = ".", limit: int = 25) -> Dict[str, Any]:
    ok, root, err = validate_safe_path(directory or ".")
    if not ok or root is None:
        raise PermissionError(err)
    if not root.is_dir():
        raise ValueError(f"'{directory}' is not a directory.")

    q = (query or "").strip().lower()
    limit = max(1, min(100, int(limit)))
    matches: List[Dict[str, Any]] = []
    base = settings.approved_dirs[0]

    for current_root, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in sorted(dirnames) if d not in BLOCKED_PATH_PARTS]
        for fname in sorted(filenames):
            fpath = Path(current_root) / fname
            if not _is_entry_allowed(fpath):
                continue
            if not q or q in fname.lower() or q in str(fpath).lower():
                try:
                    rel = str(fpath.relative_to(base))
                except ValueError:
                    rel = str(fpath)
                matches.append(
                    {
                        "path": rel,
                        "size_bytes": fpath.stat().st_size,
                    }
                )
                if len(matches) >= limit:
                    return {"root": str(root), "count": len(matches), "files": matches}

    return {"root": str(root), "count": len(matches), "files": matches}


def read_text_file(
    file_path: str, start_line: int = 1, max_lines: int = 120
) -> Dict[str, Any]:
    ok, resolved, err = validate_safe_path(file_path)
    if not ok or resolved is None:
        raise PermissionError(err)
    if not resolved.exists() or not resolved.is_file():
        raise FileNotFoundError(f"File '{file_path}' does not exist.")

    size = resolved.stat().st_size
    if size > settings.max_file_read_bytes:
        raise ValueError(
            f"File exceeds size limit ({size} bytes > {settings.max_file_read_bytes} bytes)."
        )

    raw = resolved.read_bytes()
    if b"\x00" in raw[:4096]:
        raise ValueError("Refusing to read binary file as text.")

    text = raw.decode("utf-8", errors="replace")
    lines = text.splitlines()
    start = max(1, int(start_line))
    count = max(1, min(300, int(max_lines)))
    slice_lines = lines[start - 1 : start - 1 + count]

    return {
        "path": file_path,
        "total_lines": len(lines),
        "start_line": start,
        "returned_lines": len(slice_lines),
        "content": "\n".join(slice_lines),
    }


def list_project_files(directory: str = ".", max_depth: int = 3) -> Dict[str, Any]:
    ok, root, err = validate_safe_path(directory or ".")
    if not ok or root is None:
        raise PermissionError(err)
    if not root.is_dir():
        raise ValueError(f"'{directory}' is not a directory.")

    max_depth = max(1, min(6, int(max_depth)))
    base = settings.approved_dirs[0]
    files: List[str] = []

    for current_root, dirnames, filenames in os.walk(root):
        rel_dir = Path(current_root).relative_to(root)
        depth = 0 if str(rel_dir) == "." else len(rel_dir.parts)
        if depth >= max_depth:
            dirnames[:] = []
        else:
            dirnames[:] = [d for d in sorted(dirnames) if d not in BLOCKED_PATH_PARTS]
        for fname in sorted(filenames):
            fpath = Path(current_root) / fname
            if not _is_entry_allowed(fpath):
                continue
            try:
                files.append(str(fpath.relative_to(base)))
            except ValueError:
                files.append(str(fpath))
            if len(files) >= 200:
                return {"truncated": True, "count": len(files), "files": files}

    return {"truncated": False, "count": len(files), "files": files}


def search_code(
    pattern: str, directory: str = ".", max_results: int = 30
) -> Dict[str, Any]:
    if not pattern or not pattern.strip():
        raise ValueError("Search pattern is required.")
    ok, root, err = validate_safe_path(directory or ".")
    if not ok or root is None:
        raise PermissionError(err)

    max_results = max(1, min(80, int(max_results)))
    regex = re.compile(re.escape(pattern.strip()), re.IGNORECASE)
    base = settings.approved_dirs[0]
    hits: List[Dict[str, Any]] = []

    for current_root, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in sorted(dirnames) if d not in BLOCKED_PATH_PARTS]
        for fname in sorted(filenames):
            fpath = Path(current_root) / fname
            if not _is_entry_allowed(fpath):
                continue
            try:
                if fpath.stat().st_size > settings.max_file_read_bytes:
                    continue
                raw = fpath.read_bytes()
                if b"\x00" in raw[:1024]:
                    continue
                for idx, line in enumerate(
                    raw.decode("utf-8", errors="ignore").splitlines(), start=1
                ):
                    if regex.search(line):
                        try:
                            rel = str(fpath.relative_to(base))
                        except ValueError:
                            rel = str(fpath)
                        hits.append(
                            {
                                "file": rel,
                                "line": idx,
                                "snippet": line.strip()[:160],
                            }
                        )
                        if len(hits) >= max_results:
                            return {"pattern": pattern, "count": len(hits), "matches": hits}
            except Exception:
                continue

    return {"pattern": pattern, "count": len(hits), "matches": hits}


def inspect_project_structure(directory: str = ".") -> Dict[str, Any]:
    ok, root, err = validate_safe_path(directory or ".")
    if not ok or root is None:
        raise PermissionError(err)
    top_dirs: List[str] = []
    top_files: List[str] = []
    for entry in sorted(root.iterdir(), key=lambda p: p.name.lower()):
        if not _is_entry_allowed(entry):
            continue
        if entry.is_dir():
            top_dirs.append(entry.name)
        elif entry.is_file():
            top_files.append(entry.name)
    return {
        "root": str(root),
        "directories": top_dirs,
        "files": top_files,
    }


TOOL_SPECS: List[Dict[str, Any]] = [
    {
        "name": "search_local_files",
        "category": "files",
        "description": "Search filenames in approved local workspace directories.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Filename substring to match."},
                "directory": {"type": "string", "default": "."},
                "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 25},
            },
            "required": ["query"],
        },
        "handler": search_local_files,
    },
    {
        "name": "read_text_file",
        "category": "files",
        "description": "Read lines from an approved non-sensitive text file within size limits.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "file_path": {"type": "string"},
                "start_line": {"type": "integer", "minimum": 1, "default": 1},
                "max_lines": {"type": "integer", "minimum": 1, "maximum": 300, "default": 120},
            },
            "required": ["file_path"],
        },
        "handler": read_text_file,
    },
    {
        "name": "list_project_files",
        "category": "files",
        "description": "List files in the approved project workspace up to a bounded depth.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "directory": {"type": "string", "default": "."},
                "max_depth": {"type": "integer", "minimum": 1, "maximum": 6, "default": 3},
            },
        },
        "handler": list_project_files,
    },
    {
        "name": "search_code",
        "category": "files",
        "description": "Search text/code inside approved workspace files (excluding secrets & binaries).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "pattern": {"type": "string"},
                "directory": {"type": "string", "default": "."},
                "max_results": {"type": "integer", "minimum": 1, "maximum": 80, "default": 30},
            },
            "required": ["pattern"],
        },
        "handler": search_code,
    },
    {
        "name": "inspect_project_structure",
        "category": "files",
        "description": "Inspect top-level directories and files of the approved project workspace.",
        "inputSchema": {
            "type": "object",
            "properties": {"directory": {"type": "string", "default": "."}},
        },
        "handler": inspect_project_structure,
    },
]
