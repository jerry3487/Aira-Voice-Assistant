#!/usr/bin/env bash
set -euo pipefail

echo "=== LocalVox MCP Local Setup (CPU / 8GB RAM Optimized) ==="

python3 -m venv backend/.venv
source backend/.venv/bin/activate

python -m pip install --upgrade pip
# Install CPU-only PyTorch first to save ~2GB disk/RAM vs CUDA wheels
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r backend/requirements.txt

mkdir -p backend/voices backend/data

echo ""
echo "=== Downloading Piper English Voice (en_US-lessac-medium) ==="
if [ ! -f backend/voices/en_US-lessac-medium.onnx ]; then
  curl -L -o backend/voices/en_US-lessac-medium.onnx \
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx"
  curl -L -o backend/voices/en_US-lessac-medium.onnx.json \
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json"
fi

echo ""
echo "=== Checking Ollama ==="
if command -v ollama >/dev/null 2>&1; then
  echo "Pulling recommended small tool-capable model: qwen3:1.7b"
  ollama pull qwen3:1.7b
else
  echo "Ollama not found. Install from https://ollama.com then run: ollama pull qwen3:1.7b"
fi

echo ""
echo "Setup complete! Start backend with:"
echo "  source backend/.venv/bin/activate && uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000"
