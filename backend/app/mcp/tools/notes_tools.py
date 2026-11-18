"""Notes and todo productivity MCP tools backed by SQLite."""

from __future__ import annotations

import json
from typing import Any, Dict, List

from app.database.sqlite import get_db, utc_now_iso


def create_note(title: str, content: str, tags: List[str] | None = None) -> Dict[str, Any]:
    title_clean = (title or "").strip()
    content_clean = (content or "").strip()
    if not title_clean or not content_clean:
        raise ValueError("Both 'title' and 'content' are required.")
    clean_tags = [str(t).strip() for t in (tags or []) if str(t).strip()]
    now = utc_now_iso()
    with get_db() as conn:
        cur = conn.execute(
            """
            INSERT INTO notes (title, content, tags_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (title_clean, content_clean, json.dumps(clean_tags), now, now),
        )
        note_id = cur.lastrowid
    return {
        "status": "created",
        "id": note_id,
        "title": title_clean,
        "content": content_clean,
        "tags": clean_tags,
    }


def search_notes(query: str = "", limit: int = 20) -> Dict[str, Any]:
    limit = max(1, min(100, int(limit)))
    q = f"%{(query or '').strip()}%"
    with get_db() as conn:
        if (query or "").strip():
            rows = conn.execute(
                """
                SELECT id, title, content, tags_json, created_at, updated_at
                FROM notes
                WHERE title LIKE ? OR content LIKE ? OR tags_json LIKE ?
                ORDER BY updated_at DESC
                LIMIT ?
                """,
                (q, q, q, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT id, title, content, tags_json, created_at, updated_at
                FROM notes
                ORDER BY updated_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

    notes = []
    for r in rows:
        item = dict(r)
        item["tags"] = json.loads(item.pop("tags_json", "[]") or "[]")
        notes.append(item)
    return {"count": len(notes), "notes": notes}


def list_notes(limit: int = 30) -> Dict[str, Any]:
    return search_notes(query="", limit=limit)


def update_note(
    note_id: int,
    title: str | None = None,
    content: str | None = None,
    tags: List[str] | None = None,
) -> Dict[str, Any]:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM notes WHERE id = ?", (int(note_id),)).fetchone()
        if not row:
            raise ValueError(f"Note #{note_id} not found.")
        new_title = title.strip() if title is not None else row["title"]
        new_content = content.strip() if content is not None else row["content"]
        new_tags_json = (
            json.dumps([str(t).strip() for t in tags if str(t).strip()])
            if tags is not None
            else row["tags_json"]
        )
        now = utc_now_iso()
        conn.execute(
            """
            UPDATE notes SET title = ?, content = ?, tags_json = ?, updated_at = ?
            WHERE id = ?
            """,
            (new_title, new_content, new_tags_json, now, int(note_id)),
        )
    return {
        "status": "updated",
        "id": int(note_id),
        "title": new_title,
        "content": new_content,
        "tags": json.loads(new_tags_json or "[]"),
    }


def delete_note(note_id: int, confirmed: bool = False) -> Dict[str, Any]:
    if not confirmed:
        return {
            "status": "confirmation_required",
            "message": f"Confirmation required before deleting note #{note_id}.",
            "note_id": int(note_id),
        }
    with get_db() as conn:
        row = conn.execute("SELECT id, title FROM notes WHERE id = ?", (int(note_id),)).fetchone()
        if not row:
            raise ValueError(f"Note #{note_id} not found.")
        conn.execute("DELETE FROM notes WHERE id = ?", (int(note_id),))
    return {"status": "deleted", "id": int(note_id), "title": row["title"]}


def create_todo(
    title: str, priority: str = "medium", due_date: str | None = None
) -> Dict[str, Any]:
    title_clean = (title or "").strip()
    if not title_clean:
        raise ValueError("Todo title is required.")
    prio = priority if priority in ("low", "medium", "high") else "medium"
    now = utc_now_iso()
    with get_db() as conn:
        cur = conn.execute(
            """
            INSERT INTO todos (title, status, priority, due_date, created_at, updated_at)
            VALUES (?, 'pending', ?, ?, ?, ?)
            """,
            (title_clean, prio, due_date, now, now),
        )
        todo_id = cur.lastrowid
    return {
        "status": "created",
        "id": todo_id,
        "title": title_clean,
        "todo_status": "pending",
        "priority": prio,
        "due_date": due_date,
    }


def list_todos(status: str | None = None, limit: int = 50) -> Dict[str, Any]:
    limit = max(1, min(100, int(limit)))
    with get_db() as conn:
        if status and status in ("pending", "in_progress", "completed"):
            rows = conn.execute(
                """
                SELECT id, title, status, priority, due_date, created_at, updated_at
                FROM todos WHERE status = ?
                ORDER BY updated_at DESC LIMIT ?
                """,
                (status, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT id, title, status, priority, due_date, created_at, updated_at
                FROM todos
                ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, updated_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
    todos = [dict(r) for r in rows]
    return {"count": len(todos), "todos": todos}


def update_todo_status(todo_id: int, status: str) -> Dict[str, Any]:
    if status not in ("pending", "in_progress", "completed"):
        raise ValueError("Status must be 'pending', 'in_progress', or 'completed'.")
    now = utc_now_iso()
    with get_db() as conn:
        row = conn.execute("SELECT id, title FROM todos WHERE id = ?", (int(todo_id),)).fetchone()
        if not row:
            raise ValueError(f"Todo #{todo_id} not found.")
        conn.execute(
            "UPDATE todos SET status = ?, updated_at = ? WHERE id = ?",
            (status, now, int(todo_id)),
        )
    return {"status": "updated", "id": int(todo_id), "title": row["title"], "todo_status": status}


TOOL_SPECS: List[Dict[str, Any]] = [
    {
        "name": "create_note",
        "category": "notes",
        "description": "Create and save a persistent note in SQLite.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "content": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["title", "content"],
        },
        "handler": create_note,
    },
    {
        "name": "search_notes",
        "category": "notes",
        "description": "Search local notes by title, content, or tag.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20},
            },
        },
        "handler": search_notes,
    },
    {
        "name": "list_notes",
        "category": "notes",
        "description": "List saved notes ordered by most recently updated.",
        "inputSchema": {
            "type": "object",
            "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 30}},
        },
        "handler": list_notes,
    },
    {
        "name": "update_note",
        "category": "notes",
        "description": "Update an existing note's title, content, or tags.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "note_id": {"type": "integer"},
                "title": {"type": "string"},
                "content": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["note_id"],
        },
        "handler": update_note,
    },
    {
        "name": "delete_note",
        "category": "notes",
        "description": "Delete a saved note by ID (requires explicit confirmation).",
        "requires_confirmation": True,
        "inputSchema": {
            "type": "object",
            "properties": {
                "note_id": {"type": "integer"},
                "confirmed": {"type": "boolean", "default": False},
            },
            "required": ["note_id"],
        },
        "handler": delete_note,
    },
    {
        "name": "create_todo",
        "category": "notes",
        "description": "Create a local task / todo item in SQLite.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "priority": {"type": "string", "enum": ["low", "medium", "high"], "default": "medium"},
                "due_date": {"type": "string"},
            },
            "required": ["title"],
        },
        "handler": create_todo,
    },
    {
        "name": "list_todos",
        "category": "notes",
        "description": "List todo items optionally filtered by status.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "status": {"type": "string", "enum": ["pending", "in_progress", "completed"]},
                "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 50},
            },
        },
        "handler": list_todos,
    },
    {
        "name": "update_todo_status",
        "category": "notes",
        "description": "Update a todo item's status (pending, in_progress, completed).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "todo_id": {"type": "integer"},
                "status": {"type": "string", "enum": ["pending", "in_progress", "completed"]},
            },
            "required": ["todo_id", "status"],
        },
        "handler": update_todo_status,
    },
]
