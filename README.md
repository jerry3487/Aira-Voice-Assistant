---
title: Aira
colorFrom: blue
colorTo: slate
sdk: docker
app_port: 7860
pinned: false
---

# Aira — Real-Time AI Voice Assistant & Custom MCP Server

Aira is a multilingual, real-time voice-to-voice AI assistant featuring a custom Python Model Context Protocol (MCP) server (30 tools, 7 resources, 5 prompts), SQLite persistent memory/notes/todos, Web Audio VAD spectrum monitoring, and a Light/Dark Split Acoustic Studio UI.

---

## Free Server Hosting Options

### Option A: Render Free Web Service (Easiest — **1-Click GitHub Deploy, $0/month**)
1. Push this repository to **GitHub**.
2. Open `https://dashboard.render.com` -> **New +** -> **Blueprint** (or **Web Service**) and select your GitHub repo (`render.yaml` is already included).
3. Click **Deploy**. You get a live HTTPS URL (`https://aira-voice.onrender.com`) with WebSockets, live browser voice (`SpeechRecognition` + `speechSynthesis`), SQLite, and all 30 Python MCP tools.
4. *(Optional free open-ended LLM)*: Render's 512 MB free tier cannot hold a local Ollama model in RAM, so if you want general LLM chat in addition to the 30 MCP tools, set these free Groq environment variables in Render:
   - `LLM_API_URL` = `https://api.groq.com/openai/v1`
   - `LLM_API_KEY` = your free key from `https://console.groq.com`
   - `LLM_API_MODEL` = `llama-3.1-8b-instant`

---

### Option B: Docker Container Hosting (`Dockerfile` included — Koyeb Free / Cloud VM)
If your host supports free Docker containers (e.g. **Koyeb Free Tier**, **Oracle Cloud Always Free VM 24 GB RAM**, or **Hugging Face Spaces PRO**):
- Push this repo and deploy using `Dockerfile`.
- `docker-entrypoint.sh` automatically launches Ollama + FastAPI + Piper + Node production server on `PORT` (`7860` default in Docker) whenever >= 3.5 GB RAM is available.

---

## Running 100% Locally

```bash
# 1. Install Node & Python dependencies + local AI tools
npm install
bash backend/scripts/setup_local.sh

# 2. Start Ollama & FastAPI (in separate terminals or background)
ollama serve && ollama pull qwen3:1.7b
cd backend && uvicorn app.main:app --host 127.0.0.1 --port 8000

# 3. Run Aira web + MCP bridge on port 3000
npm run dev
```
