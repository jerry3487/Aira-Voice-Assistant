"""SQLite conversation & memory service."""

from __future__ import annotations

import json
import uuid
from typing import Any, Dict, List, Optional

from app.database.sqlite import get_db, utc_now_iso


class MemoryService:
    def create_conversation(self, title: str = "Voice Session", language: str = "en") -> str:
        conv_id = str(uuid.uuid4())
        now = utc_now_iso()
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO conversations (id, title, language, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (conv_id, title, language, now, now),
            )
        return conv_id

    def append_message(
        self,
        conversation_id: str,
        role: str,
        content: str,
        language: str = "en",
        tool_calls: Optional[List[Dict[str, Any]]] = None,
        metrics: Optional[Dict[str, Any]] = None,
    ) -> int:
        now = utc_now_iso()
        with get_db() as conn:
            existing = conn.execute(
                "SELECT id FROM conversations WHERE id = ?", (conversation_id,)
            ).fetchone()
            if not existing:
                conn.execute(
                    """
                    INSERT INTO conversations (id, title, language, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (conversation_id, content[:48] or "Voice Session", language, now, now),
                )
            else:
                conn.execute(
                    "UPDATE conversations SET updated_at = ? WHERE id = ?",
                    (now, conversation_id),
                )
            cur = conn.execute(
                """
                INSERT INTO messages (conversation_id, role, content, language, tool_calls_json, metrics_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    conversation_id,
                    role,
                    content,
                    language,
                    json.dumps(tool_calls) if tool_calls else None,
                    json.dumps(metrics) if metrics else None,
                    now,
                ),
            )
            return int(cur.lastrowid or 0)

    def get_recent_messages(self, conversation_id: str, limit: int = 12) -> List[Dict[str, Any]]:
        with get_db() as conn:
            rows = conn.execute(
                """
                SELECT role, content, language, created_at
                FROM messages
                WHERE conversation_id = ? AND role IN ('user', 'assistant')
                ORDER BY id DESC
                LIMIT ?
                """,
                (conversation_id, limit),
            ).fetchall()
        return [dict(r) for r in reversed(rows)]

    def get_relevant_memories(self, query: str, limit: int = 5) -> List[Dict[str, Any]]:
        with get_db() as conn:
            rows = conn.execute(
                """
                SELECT id, key, content, category, importance
                FROM memories
                ORDER BY importance DESC, updated_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [dict(r) for r in rows]
