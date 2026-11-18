"""Thread-safe local SQLite storage for conversations, memories, notes, todos, and MCP logs."""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, Optional

from app.config.settings import settings


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_db_initialized(db_path: Optional[Path] = None) -> Path:
    path = db_path or settings.db_path
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(str(path), timeout=15.0) as conn:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA foreign_keys=ON;")
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                language TEXT DEFAULT 'en',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
                content TEXT NOT NULL,
                language TEXT DEFAULT 'en',
                tool_calls_json TEXT,
                metrics_json TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT NOT NULL,
                content TEXT NOT NULL,
                category TEXT DEFAULT 'general',
                importance INTEGER DEFAULT 3,
                source_conversation_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                tags_json TEXT DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS todos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed')),
                priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high')),
                due_date TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS mcp_tool_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tool_name TEXT NOT NULL,
                arguments_json TEXT NOT NULL,
                result_json TEXT,
                error TEXT,
                duration_ms REAL NOT NULL DEFAULT 0,
                status TEXT NOT NULL CHECK(status IN ('success', 'error', 'cancelled', 'disabled')),
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS mcp_tool_settings (
                tool_name TEXT PRIMARY KEY,
                enabled INTEGER NOT NULL DEFAULT 1,
                requires_confirmation INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_memories_cat ON memories(category, updated_at);
            CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at);
            CREATE INDEX IF NOT EXISTS idx_mcp_logs_created ON mcp_tool_logs(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
            """
        )
        conn.commit()
    return path


@contextmanager
def get_db(db_path: Optional[Path] = None) -> Iterator[sqlite3.Connection]:
    path = ensure_db_initialized(db_path)
    conn = sqlite3.connect(str(path), timeout=15.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON;")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def log_mcp_execution(
    tool_name: str,
    arguments: dict,
    result: Optional[dict],
    error: Optional[str],
    duration_ms: float,
    status: str,
    db_path: Optional[Path] = None,
) -> int:
    with get_db(db_path) as conn:
        cur = conn.execute(
            """
            INSERT INTO mcp_tool_logs (tool_name, arguments_json, result_json, error, duration_ms, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                tool_name,
                json.dumps(arguments, ensure_ascii=False),
                json.dumps(result, ensure_ascii=False) if result is not None else None,
                error,
                round(duration_ms, 2),
                status,
                utc_now_iso(),
            ),
        )
        return int(cur.lastrowid or 0)
