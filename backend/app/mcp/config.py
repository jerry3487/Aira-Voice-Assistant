"""Security and metadata configuration for the custom LocalVox MCP server."""

from __future__ import annotations

from pathlib import Path
from typing import FrozenSet, Tuple

from app.config.settings import settings

MCP_SERVER_NAME = "local-voice-mcp"
MCP_SERVER_VERSION = "1.0.0"

# Sensitive file patterns blocked from all local file tools
BLOCKED_PATH_PARTS: FrozenSet[str] = frozenset(
    {
        ".git",
        "node_modules",
        ".venv",
        "venv",
        "__pycache__",
        ".ssh",
        ".aws",
        ".gnupg",
        ".playwright-cli",
    }
)

BLOCKED_FILENAMES: FrozenSet[str] = frozenset(
    {
        ".env",
        ".env.local",
        ".env.production",
        ".env.development",
        "id_rsa",
        "id_ed25519",
        "credentials.json",
        "secrets.json",
        "shadow",
        "passwd",
    }
)

BLOCKED_EXTENSIONS: FrozenSet[str] = frozenset(
    {
        ".pem",
        ".key",
        ".p12",
        ".pfx",
        ".kdbx",
        ".sqlite",
        ".db",
        ".db-wal",
        ".db-shm",
    }
)

SENSITIVE_TOOLS: FrozenSet[str] = frozenset(
    {
        "delete_memory",
        "delete_note",
    }
)


def validate_safe_path(target_path: str) -> Tuple[bool, Path | None, str]:
    """Resolve and validate that target_path stays strictly inside approved directories and never touches secrets."""
    if not target_path or not isinstance(target_path, str):
        return False, None, "Path must be a non-empty string."

    raw = Path(target_path)
    if not raw.is_absolute():
        # Resolve relative paths against the first approved directory (project workspace)
        base = settings.approved_dirs[0]
        candidate = (base / raw).resolve()
    else:
        candidate = raw.resolve()

    # Check approved root containment
    allowed = False
    for approved in settings.approved_dirs:
        try:
            candidate.relative_to(approved.resolve())
            allowed = True
            break
        except ValueError:
            continue

    if not allowed:
        return (
            False,
            None,
            f"Access denied: '{target_path}' is outside approved directories.",
        )

    # Check blocked parts / filenames / extensions
    for part in candidate.parts:
        if part in BLOCKED_PATH_PARTS:
            return False, None, f"Access denied: directory '{part}' is restricted."

    name_lower = candidate.name.lower()
    if name_lower in BLOCKED_FILENAMES or name_lower.startswith(".env."):
        return False, None, f"Access denied: '{candidate.name}' is a restricted file."

    if "secret" in name_lower or "credential" in name_lower or "password" in name_lower:
        return False, None, f"Access denied: potentially sensitive filename '{candidate.name}'."

    if candidate.suffix.lower() in BLOCKED_EXTENSIONS:
        return False, None, f"Access denied: extension '{candidate.suffix}' is restricted."

    return True, candidate, ""
