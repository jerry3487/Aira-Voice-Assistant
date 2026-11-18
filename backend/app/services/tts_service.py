"""Local + Free Cloud Text-to-Speech service.

Engines supported (in priority order when LOCALVOX_TTS_ENGINE is set):
  - edge   : Microsoft Edge Neural TTS (free, no API key, high quality, 70+ languages)
  - piper  : Local offline Piper TTS (needs .onnx voice model files)

Edge TTS language → voice mapping covers all major Indian languages:
  ta (Tamil), hi (Hindi), te (Telugu), kn (Kannada), ml (Malayalam),
  bn (Bengali), mr (Marathi), gu (Gujarati), pa (Punjabi), en (English)
"""

from __future__ import annotations

import asyncio
import io
import json
import time
import wave
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.config.settings import settings

# ---------------------------------------------------------------------------
# Edge TTS voice map — free Microsoft Neural voices, no API key required
# Language code (2-char ISO 639-1) → (voice_name, gender)
# ---------------------------------------------------------------------------
EDGE_VOICE_MAP: Dict[str, Dict[str, str]] = {
    "ta": {"female": "ta-IN-PallaviNeural",   "male": "ta-IN-ValluvarNeural"},
    "hi": {"female": "hi-IN-SwaraNeural",     "male": "hi-IN-MadhurNeural"},
    "te": {"female": "te-IN-ShrutiNeural",    "male": "te-IN-MohanNeural"},
    "kn": {"female": "kn-IN-SapnaNeural",     "male": "kn-IN-GaganNeural"},
    "ml": {"female": "ml-IN-SobhanaNeural",   "male": "ml-IN-MidhunNeural"},
    "bn": {"female": "bn-IN-TanishaaNeural",  "male": "bn-IN-BashkarNeural"},
    "mr": {"female": "mr-IN-AarohiNeural",    "male": "mr-IN-ManoharNeural"},
    "gu": {"female": "gu-IN-DhwaniNeural",    "male": "gu-IN-NiranjanNeural"},
    "pa": {"female": "pa-IN-OjasNeural",      "male": "pa-IN-OjasNeural"},  # only one available
    "en": {"female": "en-IN-NeerjaNeural",    "male": "en-IN-PrabhatNeural"},
    "fr": {"female": "fr-FR-DeniseNeural",    "male": "fr-FR-HenriNeural"},
    "de": {"female": "de-DE-KatjaNeural",     "male": "de-DE-ConradNeural"},
    "es": {"female": "es-ES-ElviraNeural",    "male": "es-ES-AlvaroNeural"},
    "ar": {"female": "ar-SA-ZariyahNeural",   "male": "ar-SA-HamedNeural"},
    "zh": {"female": "zh-CN-XiaoxiaoNeural",  "male": "zh-CN-YunxiNeural"},
    "ja": {"female": "ja-JP-NanamiNeural",    "male": "ja-JP-KeitaNeural"},
    "ko": {"female": "ko-KR-SunHiNeural",     "male": "ko-KR-InJoonNeural"},
    "pt": {"female": "pt-BR-FranciscaNeural", "male": "pt-BR-AntonioNeural"},
    "ru": {"female": "ru-RU-SvetlanaNeural",  "male": "ru-RU-DmitryNeural"},
}


def _lang_code(full_lang: str) -> str:
    """Normalize 'ta-IN', 'ta_IN', 'tamil', 'ta' → 'ta'."""
    code = full_lang.lower().replace("_", "-").split("-")[0].strip()
    # Map some full names
    name_map = {
        "tamil": "ta", "hindi": "hi", "telugu": "te", "kannada": "kn",
        "malayalam": "ml", "bengali": "bn", "marathi": "mr",
        "gujarati": "gu", "punjabi": "pa", "english": "en",
    }
    return name_map.get(code, code)


def _synthesize_edge(
    text: str,
    lang: str,
    voice_name: Optional[str] = None,
    gender: str = "female",
    rate: str = "+0%",
) -> bytes:
    """Call edge-tts synchronously and return raw MP3 bytes."""
    import edge_tts  # type: ignore

    if not voice_name or not voice_name.strip():
        lang_key = _lang_code(lang)
        voices = EDGE_VOICE_MAP.get(lang_key, EDGE_VOICE_MAP["en"])
        voice_name = voices.get(gender, voices["female"])

    target_voice = voice_name.strip()

    async def _run() -> bytes:
        communicate = edge_tts.Communicate(text, target_voice, rate=rate)
        buf = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                buf.write(chunk["data"])
        return buf.getvalue()

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                future = pool.submit(asyncio.run, _run())
                return future.result(timeout=30)
        else:
            return loop.run_until_complete(_run())
    except Exception:
        return asyncio.run(_run())


def _mp3_to_wav(mp3_bytes: bytes) -> bytes:
    """Convert MP3 bytes to WAV bytes using pydub or ffmpeg subprocess."""
    # Try pydub first
    try:
        from pydub import AudioSegment  # type: ignore
        seg = AudioSegment.from_file(io.BytesIO(mp3_bytes), format="mp3")
        buf = io.BytesIO()
        seg.export(buf, format="wav")
        return buf.getvalue()
    except Exception:
        pass

    # Fallback: ffmpeg subprocess
    import subprocess, tempfile, os
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp_in:
        tmp_in.write(mp3_bytes)
        tmp_in_path = tmp_in.name
    tmp_out_path = tmp_in_path.replace(".mp3", ".wav")
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", tmp_in_path, tmp_out_path],
            capture_output=True, check=True, timeout=30,
        )
        with open(tmp_out_path, "rb") as f:
            return f.read()
    finally:
        for p in (tmp_in_path, tmp_out_path):
            try:
                os.unlink(p)
            except OSError:
                pass


class TTSService:
    """Multi-engine TTS wrapper: Edge (free neural) → Piper (local offline)."""

    def __init__(self) -> None:
        self._loaded_voices: Dict[str, Any] = {}
        self.active_engine = settings.tts_engine  # "edge" or "piper"
        self.active_voice_id: Optional[str] = None
        self.speed: float = 1.0

    # ------------------------------------------------------------------
    # Voice discovery (Piper .onnx files)
    # ------------------------------------------------------------------
    def discover_voices(self) -> List[Dict[str, Any]]:
        voices: List[Dict[str, Any]] = [
            {"id": "ta-IN-PallaviNeural", "engine": "edge", "language": "ta", "gender": "female", "name": "Tamil - Pallavi (Neural)", "license": "Microsoft Neural", "sample_rate": 24000, "path": "edge-cloud"},
            {"id": "ta-IN-ValluvarNeural", "engine": "edge", "language": "ta", "gender": "male", "name": "Tamil - Valluvar (Neural)", "license": "Microsoft Neural", "sample_rate": 24000, "path": "edge-cloud"},
            {"id": "hi-IN-SwaraNeural", "engine": "edge", "language": "hi", "gender": "female", "name": "Hindi - Swara (Neural)", "license": "Microsoft Neural", "sample_rate": 24000, "path": "edge-cloud"},
            {"id": "hi-IN-MadhurNeural", "engine": "edge", "language": "hi", "gender": "male", "name": "Hindi - Madhur (Neural)", "license": "Microsoft Neural", "sample_rate": 24000, "path": "edge-cloud"},
            {"id": "te-IN-ShrutiNeural", "engine": "edge", "language": "te", "gender": "female", "name": "Telugu - Shruti (Neural)", "license": "Microsoft Neural", "sample_rate": 24000, "path": "edge-cloud"},
            {"id": "kn-IN-SapnaNeural", "engine": "edge", "language": "kn", "gender": "female", "name": "Kannada - Sapna (Neural)", "license": "Microsoft Neural", "sample_rate": 24000, "path": "edge-cloud"},
            {"id": "ml-IN-SobhanaNeural", "engine": "edge", "language": "ml", "gender": "female", "name": "Malayalam - Sobhana (Neural)", "license": "Microsoft Neural", "sample_rate": 24000, "path": "edge-cloud"},
            {"id": "en-IN-NeerjaNeural", "engine": "edge", "language": "en", "gender": "female", "name": "English (India) - Neerja (Neural)", "license": "Microsoft Neural", "sample_rate": 24000, "path": "edge-cloud"},
            {"id": "en-US-AriaNeural", "engine": "edge", "language": "en", "gender": "female", "name": "English (US) - Aria (Neural)", "license": "Microsoft Neural", "sample_rate": 24000, "path": "edge-cloud"},
        ]
        if settings.voices_dir.exists():
            for onnx_path in sorted(settings.voices_dir.glob("*.onnx")):
                stem = onnx_path.stem
                lang = stem.split("_")[0] if "_" in stem else "en"
                meta_path = onnx_path.with_suffix(".onnx.json")
                license_str = "Verify .onnx.json"
                gender = "neutral"
                sample_rate = 22050
                if meta_path.exists():
                    try:
                        meta = json.loads(meta_path.read_text(encoding="utf-8"))
                        license_str = meta.get("license", license_str)
                        gender = meta.get("gender", gender)
                        sample_rate = meta.get("audio", {}).get("sample_rate", sample_rate)
                    except Exception:
                        pass
                voices.append({
                    "id": stem,
                    "engine": "piper",
                    "language": lang,
                    "gender": gender,
                    "license": license_str,
                    "sample_rate": sample_rate,
                    "path": str(onnx_path),
                })
        return voices

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------
    def get_status(self) -> Dict[str, Any]:
        piper_installed = False
        edge_installed = False
        kokoro_installed = False
        try:
            import piper  # type: ignore  # noqa: F401
            piper_installed = True
        except ImportError:
            pass
        try:
            import edge_tts  # type: ignore  # noqa: F401
            edge_installed = True
        except ImportError:
            pass
        try:
            import kokoro  # type: ignore  # noqa: F401
            kokoro_installed = True
        except ImportError:
            pass

        voices = self.discover_voices()
        if not self.active_voice_id and voices:
            self.active_voice_id = voices[0]["id"]

        return {
            "active_engine": self.active_engine,
            "piper_installed": piper_installed,
            "edge_tts_installed": edge_installed,
            "kokoro_installed": kokoro_installed,
            "voices_dir": str(settings.voices_dir),
            "installed_voices": voices,
            "active_voice_id": self.active_voice_id,
            "edge_supported_languages": sorted(EDGE_VOICE_MAP.keys()),
            "speed": self.speed,
        }

    # ------------------------------------------------------------------
    # Main synthesis entry point
    # ------------------------------------------------------------------
    def synthesize_wav(
        self, text: str, voice_id: Optional[str] = None, response_language: str = "en"
    ) -> Dict[str, Any]:
        start = time.perf_counter()
        clean_text = (text or "").strip()
        if not clean_text:
            raise ValueError("Cannot synthesize empty text.")

        engine = self.active_engine.lower()

        # ---- Edge TTS (free neural, default when engine=="edge") --------
        if engine == "edge":
            return self._synthesize_edge_engine(clean_text, response_language, voice_id, start)

        # ---- Piper TTS (local offline) ----------------------------------
        return self._synthesize_piper_engine(clean_text, voice_id, response_language, start)

    # ------------------------------------------------------------------
    # Edge engine
    # ------------------------------------------------------------------
    def _synthesize_edge_engine(
        self, text: str, response_language: str, voice_id: Optional[str], start: float
    ) -> Dict[str, Any]:
        try:
            import edge_tts  # noqa: F401 — confirm installed
        except ImportError:
            return {
                "ok": False,
                "reason": "edge_tts_not_installed",
                "message": "Run: pip install edge-tts",
                "duration_ms": round((time.perf_counter() - start) * 1000.0, 1),
            }

        try:
            # Speed to edge-tts rate string: 1.0 → "+0%", 1.2 → "+20%", 0.8 → "-20%"
            pct = int((self.speed - 1.0) * 100)
            rate_str = f"+{pct}%" if pct >= 0 else f"{pct}%"

            # Use explicit voice_id if it's an Edge neural voice
            target_voice = voice_id if (voice_id and "Neural" in voice_id) else None
            mp3_bytes = _synthesize_edge(text, response_language, voice_name=target_voice, gender="female", rate=rate_str)
            if not mp3_bytes:
                raise RuntimeError("edge-tts returned empty audio")

            # Try to convert MP3 → WAV so the existing audio pipeline works
            try:
                wav_bytes = _mp3_to_wav(mp3_bytes)
                return {
                    "ok": True,
                    "engine": "edge",
                    "language": response_language,
                    "wav_bytes": wav_bytes,
                    "duration_ms": round((time.perf_counter() - start) * 1000.0, 1),
                }
            except Exception:
                # If conversion fails, return MP3 directly (server.ts can handle it)
                return {
                    "ok": True,
                    "engine": "edge",
                    "language": response_language,
                    "mp3_bytes": mp3_bytes,
                    "wav_bytes": b"",
                    "duration_ms": round((time.perf_counter() - start) * 1000.0, 1),
                }
        except Exception as exc:
            return {
                "ok": False,
                "reason": "edge_tts_error",
                "message": str(exc),
                "duration_ms": round((time.perf_counter() - start) * 1000.0, 1),
            }

    # ------------------------------------------------------------------
    # Piper engine (original logic, unchanged)
    # ------------------------------------------------------------------
    def _synthesize_piper_engine(
        self,
        text: str,
        voice_id: Optional[str],
        response_language: str,
        start: float,
    ) -> Dict[str, Any]:
        voices = self.discover_voices()
        chosen = None
        target_id = voice_id or self.active_voice_id
        for v in voices:
            if v["id"] == target_id:
                chosen = v
                break
        if chosen is None and voices:
            for v in voices:
                if v["language"].lower() == response_language.lower():
                    chosen = v
                    break
            if chosen is None:
                chosen = voices[0]

        if chosen is None:
            return {
                "ok": False,
                "reason": "no_local_piper_voice_installed",
                "duration_ms": round((time.perf_counter() - start) * 1000.0, 1),
            }

        if chosen["language"].lower() != response_language.lower():
            return {
                "ok": False,
                "reason": "language_mismatch",
                "message": (
                    f"Installed voice '{chosen['id']}' supports '{chosen['language']}', "
                    f"not '{response_language}'. Switch to engine=edge for free multilingual TTS."
                ),
                "duration_ms": round((time.perf_counter() - start) * 1000.0, 1),
            }

        from piper.voice import PiperVoice  # type: ignore

        model_path = Path(chosen["path"])
        if chosen["id"] not in self._loaded_voices:
            self._loaded_voices[chosen["id"]] = PiperVoice.load(str(model_path))
        voice = self._loaded_voices[chosen["id"]]

        buf = io.BytesIO()
        with wave.open(buf, "wb") as wav_file:
            voice.synthesize(text, wav_file, length_scale=round(1.0 / max(0.5, self.speed), 2))

        return {
            "ok": True,
            "engine": "piper",
            "voice_id": chosen["id"],
            "language": chosen["language"],
            "wav_bytes": buf.getvalue(),
            "duration_ms": round((time.perf_counter() - start) * 1000.0, 1),
        }
