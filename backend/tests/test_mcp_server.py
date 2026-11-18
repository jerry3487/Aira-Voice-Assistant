"""Unit tests for LocalVox custom MCP server, SQLite persistence, and security guards."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

import app.config.settings as cfg
from app.database.sqlite import ensure_db_initialized
from app.mcp.server import execute_tool, handle_jsonrpc_message, set_tool_enabled


class TestLocalVoxMcpServer(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmp_dir.name) / "test.db"
        cfg.settings = cfg.Settings(db_path=self.db_path)
        # Rebind module references to test DB path
        import app.database.sqlite as db_mod

        db_mod.settings = cfg.settings
        ensure_db_initialized(self.db_path)

    def tearDown(self) -> None:
        self.tmp_dir.cleanup()

    def test_memory_crud_and_confirmation_gate(self) -> None:
        res = execute_tool(
            "save_memory",
            {"key": "preferred_editor", "content": "Neovim with Python LSP", "category": "preference"},
        )
        self.assertTrue(res["ok"])
        mem_id = res["result"]["id"]

        found = execute_tool("search_memory", {"query": "Neovim"})
        self.assertTrue(found["ok"])
        self.assertEqual(found["result"]["count"], 1)

        # Unconfirmed delete must refuse and request confirmation
        blocked = execute_tool("delete_memory", {"memory_id": mem_id, "confirmed": False})
        self.assertTrue(blocked["ok"])
        self.assertEqual(blocked["result"]["status"], "confirmation_required")

        deleted = execute_tool("delete_memory", {"memory_id": mem_id, "confirmed": True})
        self.assertEqual(deleted["result"]["status"], "deleted")

    def test_notes_and_todos(self) -> None:
        note = execute_tool(
            "create_note",
            {"title": "Voice Pipeline", "content": "Use Silero VAD + faster-whisper base int8", "tags": ["voice"]},
        )
        self.assertTrue(note["ok"])
        todo = execute_tool("create_todo", {"title": "Benchmark Qwen3 1.7B", "priority": "high"})
        self.assertTrue(todo["ok"])
        todo_id = todo["result"]["id"]

        upd = execute_tool("update_todo_status", {"todo_id": todo_id, "status": "completed"})
        self.assertEqual(upd["result"]["todo_status"], "completed")

    def test_file_tools_security_blocks_traversal_and_secrets(self) -> None:
        traversal = execute_tool("read_text_file", {"file_path": "../../etc/passwd"})
        self.assertFalse(traversal["ok"])
        self.assertIn("outside approved directories", traversal["error"])

        secret_env = execute_tool("read_text_file", {"file_path": ".env.example"})
        # .env.example is explicitly allowed or .env blocked: verify .env is blocked
        env_block = execute_tool("read_text_file", {"file_path": ".env"})
        self.assertFalse(env_block["ok"])
        self.assertIn("restricted", env_block["error"].lower())

        pkg = execute_tool("read_text_file", {"file_path": "package.json", "max_lines": 10})
        self.assertTrue(pkg["ok"])
        self.assertIn("react-example", pkg["result"]["content"])

    def test_utility_ast_math_and_units(self) -> None:
        calc = execute_tool("perform_calculation", {"expression": "sqrt(144) * (5 + 3)"})
        self.assertTrue(calc["ok"])
        self.assertEqual(calc["result"]["result"], 96)

        bad_calc = execute_tool("perform_calculation", {"expression": "__import__('os').system('id')"})
        self.assertFalse(bad_calc["ok"])

        conv = execute_tool("convert_units", {"value": 100, "from_unit": "c", "to_unit": "f"})
        self.assertTrue(conv["ok"])
        self.assertEqual(conv["result"]["result"], 212.0)

    def test_tool_toggle_and_jsonrpc(self) -> None:
        set_tool_enabled("perform_calculation", False)
        disabled_res = execute_tool("perform_calculation", {"expression": "2+2"})
        self.assertFalse(disabled_res["ok"])
        self.assertIn("disabled", disabled_res["error"])
        set_tool_enabled("perform_calculation", True)

        res_list = handle_jsonrpc_message({"jsonrpc": "2.0", "id": 10, "method": "resources/list", "params": {}})
        self.assertEqual(len(res_list["result"]["resources"]), 7)

        prompt_res = handle_jsonrpc_message(
            {"jsonrpc": "2.0", "id": 11, "method": "prompts/get", "params": {"name": "system_diagnostics"}}
        )
        self.assertIn("get_system_information", json.dumps(prompt_res))


if __name__ == "__main__":
    unittest.main()
