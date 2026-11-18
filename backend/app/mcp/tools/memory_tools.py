"""Conversation memory MCP tools backed by local SQLite."""

from __future__ import annotations

from typing import Any, Dict, List

from app.database.sqlite import get_db, utc_now_iso


def save_memory(
    key: str,
    content: str,
    category: str = "general",
    importance: int = 3,
    source_conversation_id: str | None = None,
) -> Dict[str, Any]:
    key_clean = (key or "").strip()
    content_clean = (content or "").strip()
    if not key_clean or not content_clean:
        raise ValueError("Both 'key' and 'content' are required to save a memory.")
    importance = max(1, min(5, int(importance)))
    now = utc_now_iso()

    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM memories WHERE lower(key) = lower(?)", (key_clean,)
        ).fetchone()
        if existing:
            conn.execute(
                """
                UPDATE memories
                SET content = ?, category = ?, importance = ?, updated_at = ?
                WHERE id = ?
                """,
                (content_clean, category.strip() or "general", importance, now, existing["id"]),
            )
            memory_id = existing["id"]
            action = "updated"
        else:
            cur = conn.execute(
                """
                INSERT INTO memories (key, content, category, importance, source_conversation_id, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    key_clean,
                    content_clean,
                    category.strip() or "general",
                    importance,
                    source_conversation_id,
                    now,
                    now,
                ),
            )
            memory_id = cur.lastrowid
            action = "created"

    return {
        "status": action,
        "id": memory_id,
        "key": key_clean,
        "content": content_clean,
        "category": category.strip() or "general",
        "importance": importance,
    }


def search_memory(query: str = "", category: str | None = None, limit: int = 10) -> Dict[str, Any]:
    limit = max(1, min(50, int(limit)))
    q = f"%{(query or '').strip()}%"
    with get_db() as conn:
        if category and category.strip():
            rows = conn.execute(
                """
                SELECT id, key, content, category, importance, created_at, updated_at
                FROM memories
                WHERE category = ? AND (key LIKE ? OR content LIKE ?)
                ORDER BY importance DESC, updated_at DESC
                LIMIT ?
                """,
                (category.strip(), q, q, limit),
            ).fetchall()
        elif (query or "").strip():
            rows = conn.execute(
                """
                SELECT id, key, content, category, importance, created_at, updated_at
                FROM memories
                WHERE key LIKE ? OR content LIKE ? OR category LIKE ?
                ORDER BY importance DESC, updated_at DESC
                LIMIT ?
                """,
                (q, q, q, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT id, key, content, category, importance, created_at, updated_at
                FROM memories
                ORDER BY importance DESC, updated_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

    items = [dict(r) for r in rows]
    return {"count": len(items), "memories": items}


def retrieve_conversation_history(
    conversation_id: str | None = None, limit: int = 20
) -> Dict[str, Any]:
    limit = max(1, min(100, int(limit)))
    with get_db() as conn:
        if conversation_id:
            rows = conn.execute(
                """
                SELECT id, conversation_id, role, content, language, created_at
                FROM messages
                WHERE conversation_id = ?
                ORDER BY id DESC
                LIMIT ?
                """,
                (conversation_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT id, conversation_id, role, content, language, created_at
                FROM messages
                ORDER BY id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
    messages = [dict(r) for r in reversed(rows)]
    return {"count": len(messages), "messages": messages}


def summarize_conversation(conversation_id: str | None = None, max_messages: int = 12) -> Dict[str, Any]:
    hist = retrieve_conversation_history(conversation_id=conversation_id, limit=max_messages)
    msgs = hist["messages"]
    if not msgs:
        return {"summary": "No conversation messages recorded yet.", "message_count": 0}
    lines = []
    for m in msgs:
        role = m["role"].capitalize()
        snippet = m["content"].strip().replace("\n", " ")
        if len(snippet) > 160:
            snippet = snippet[:157] + "..."
        lines.append(f"{role}: {snippet}")
    return {
        "message_count": len(msgs),
        "conversation_id": msgs[-1]["conversation_id"],
        "summary": "\n".join(lines),
    }


def update_memory(
    memory_id: int,
    content: str | None = None,
    category: str | None = None,
    importance: int | None = None,
) -> Dict[str, Any]:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM memories WHERE id = ?", (int(memory_id),)).fetchone()
        if not row:
            raise ValueError(f"Memory #{memory_id} not found.")
        new_content = content.strip() if content is not None else row["content"]
        new_category = category.strip() if category is not None else row["category"]
        new_importance = (
            max(1, min(5, int(importance))) if importance is not None else row["importance"]
        )
        now = utc_now_iso()
        conn.execute(
            """
            UPDATE memories
            SET content = ?, category = ?, importance = ?, updated_at = ?
            WHERE id = ?
            """,
            (new_content, new_category, new_importance, now, int(memory_id)),
        )
    return {
        "status": "updated",
        "id": int(memory_id),
        "key": row["key"],
        "content": new_content,
        "category": new_category,
        "importance": new_importance,
    }


def delete_memory(memory_id: int, confirmed: bool = False) -> Dict[str, Any]:
    if not confirmed:
        return {
            "status": "confirmation_required",
            "message": f"Confirmation required before deleting memory #{memory_id}.",
            "memory_id": int(memory_id),
        }
    with get_db() as conn:
        row = conn.execute("SELECT id, key FROM memories WHERE id = ?", (int(memory_id),)).fetchone()
        if not row:
            raise ValueError(f"Memory #{memory_id} not found.")
        conn.execute("DELETE FROM memories WHERE id = ?", (int(memory_id),))
    return {"status": "deleted", "id": int(memory_id), "key": row["key"]}


TOOL_SPECS: List[Dict[str, Any]] = [
    {
        "name": "save_memory",
        "category": "memory",
        "description": "Save or update an important long-term memory fact or preference in SQLite.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "key": {"type": "string", "description": "Short unique memory topic key."},
                "content": {"type": "string", "description": "The factual memory content to store."},
                "category": {"type": "string", "description": "Category e.g. preference, project, profile, general."},
                "importance": {"type": "integer", "minimum": 1, "maximum": 5, "default": 3},
            },
            "required": ["key", "content"],
        },
        "handler": save_memory,
    },
    {
        "name": "search_memory",
        "category": "memory",
        "description": "Search persistent conversation memories stored in SQLite.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search keywords (empty lists top memories)."},
                "category": {"type": "string", "description": "Optional category filter."},
                "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 10},
            },
        },
        "handler": search_memory,
    },
    {
        "name": "retrieve_conversation_history",
        "category": "memory",
        "description": "Retrieve recent persisted conversation turns from SQLite.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "conversation_id": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20},
            },
        },
        "handler": retrieve_conversation_history,
    },
    {
        "name": "summarize_conversation",
        "category": "memory",
        "description": "Produce a concise structured digest of recent conversation messages.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "conversation_id": {"type": "string"},
                "max_messages": {"type": "integer", "minimum": 1, "maximum": 50, "default": 12},
            },
        },
        "handler": summarize_conversation,
    },
    {
        "name": "update_memory",
        "category": "memory",
        "description": "Update an existing memory record by numeric ID.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "memory_id": {"type": "integer"},
                "content": {"type": "string"},
                "category": {"type": "string"},
                "importance": {"type": "integer", "minimum": 1, "maximum": 5},
            },
            "required": ["memory_id"],
        },
        "handler": update_memory,
    },
    {
        "name": "delete_memory",
        "category": "memory",
        "description": "Delete a saved memory by ID (requires explicit user confirmation).",
        "requires_confirmation": True,
        "inputSchema": {
            "type": "object",
            "properties": {
                "memory_id": {"type": "integer"},
                "confirmed": {"type": "boolean", "default": False},
            },
            "required": ["memory_id"],
        },
        "handler": delete_memory,
    },
]
