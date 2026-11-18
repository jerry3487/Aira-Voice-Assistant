# LocalVox MCP — Local AI Backend & Custom MCP Server

100% private, offline-capable local voice assistant backend.

## Architecture

1. **Custom MCP Server (`app/mcp/server.py`)**: Standalone stdio JSON-RPC 2.0 & official `mcp` SDK server exposing 30 local tools (SQLite memory, system diagnostics, sandboxed workspace files, notes/todos, AST calculator/unit utilities), 7 resources, and 5 prompts.
2. **Local LLM (`Ollama`)**: Evaluates `qwen3:1.7b` (native tool calling) or `gemma3:1b`.
3. **Speech-to-Text (`faster-whisper`)**: CPU INT8 (`tiny` / `base`) with automatic language detection.
4. **Voice Activity Detection (`Silero VAD`)**: Streaming utterance boundary & barge-in detection.
5. **Text-to-Speech (`Piper`)**: Dynamic `.onnx` voice discovery with license verification.

## Quick Local Setup (8GB RAM / CPU-only)

```bash
bash backend/scripts/setup_local.sh
python3 backend/scripts/benchmark.py
```

### Start FastAPI Backend (Optional Full Python Audio Pipeline)

```bash
source backend/.venv/bin/activate
uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

### Standalone MCP Server Test (No external deps required)

```bash
python3 backend/app/mcp/server.py
```
