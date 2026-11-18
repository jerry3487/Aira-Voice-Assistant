#!/usr/bin/env bash
set -euo pipefail

export PORT="${PORT:-7860}"
export LOCALVOX_DATA_DIR="${LOCALVOX_DATA_DIR:-/app/backend/data}"
export LOCALVOX_VOICES_DIR="${LOCALVOX_VOICES_DIR:-/app/backend/voices}"
mkdir -p "$LOCALVOX_DATA_DIR" "$LOCALVOX_VOICES_DIR"

# Detect total system RAM in MB to adapt gracefully on 512MB vs 16GB free hosts
TOTAL_MEM_MB=0
if [ -r /proc/meminfo ]; then
  TOTAL_MEM_KB=$(awk '/MemTotal/ {print $2}' /proc/meminfo || echo 0)
  TOTAL_MEM_MB=$((TOTAL_MEM_KB / 1024))
fi

echo "[LocalVox] Booting container (RAM=${TOTAL_MEM_MB}MB, PORT=${PORT})"

PIDS=()
cleanup() {
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

# 1. Start local Ollama + pull small model in background if >= 3.5 GB RAM
if [ "${ENABLE_LOCAL_OLLAMA:-true}" = "true" ] && command -v ollama >/dev/null 2>&1 && [ "$TOTAL_MEM_MB" -ge 3500 ]; then
  echo "[LocalVox] Starting local Ollama daemon..."
  ollama serve >/tmp/ollama.log 2>&1 &
  PIDS+=($!)

  MODEL_TO_PULL="${LOCALVOX_LLM_MODEL:-qwen3:1.7b}"
  if [ "$TOTAL_MEM_MB" -lt 6000 ] && [ "$MODEL_TO_PULL" = "qwen3:1.7b" ]; then
    MODEL_TO_PULL="gemma3:1b"
  fi
  (
    for _ in $(seq 1 30); do
      if curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
        echo "[LocalVox] Pulling local LLM model '$MODEL_TO_PULL' in background..."
        ollama pull "$MODEL_TO_PULL" >/tmp/ollama-pull.log 2>&1 || true
        break
      fi
      sleep 1
    done
  ) &
else
  echo "[LocalVox] Skipping local Ollama (RAM=${TOTAL_MEM_MB}MB or disabled). Using MCP router / LLM_API_URL."
fi

# 2. Download default Piper voice in background if voices dir is empty
if [ "${ENABLE_PIPER_AUTO_DOWNLOAD:-true}" = "true" ] && [ "$TOTAL_MEM_MB" -ge 1500 ]; then
  if [ ! -f "$LOCALVOX_VOICES_DIR/en_US-lessac-medium.onnx" ]; then
    (
      echo "[LocalVox] Downloading Piper voice en_US-lessac-medium in background..."
      curl -fsSL -o "$LOCALVOX_VOICES_DIR/en_US-lessac-medium.onnx" \
        "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx" || true
      curl -fsSL -o "$LOCALVOX_VOICES_DIR/en_US-lessac-medium.onnx.json" \
        "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json" || true
    ) &
  fi
fi

# 3. Start Python FastAPI backend (faster-whisper + Piper TTS + MCP) on 127.0.0.1:8000
if command -v uvicorn >/dev/null 2>&1; then
  echo "[LocalVox] Starting FastAPI STT/TTS service on 127.0.0.1:8000..."
  PYTHONPATH=/app/backend uvicorn app.main:app --host 127.0.0.1 --port 8000 >/tmp/fastapi.log 2>&1 &
  PIDS+=($!)
fi

# 4. Start primary Express + WebSocket + Vite static bundle + Python MCP stdio bridge
exec env NODE_ENV=production node /app/server.ts
