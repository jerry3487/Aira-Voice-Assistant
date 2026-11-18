"""Local speech recognition (faster-whisper INT8 CPU) and Silero VAD service."""

from __future__ import annotations

import io
import time
import wave
from typing import Any, Dict, Optional

from app.config.settings import settings


class SpeechService:
    """Lazy-loading faster-whisper CPU INT8 STT + Silero VAD wrapper."""

    def __init__(self) -> None:
        self._whisper_model: Any = None
        self._vad_model: Any = None
        self.model_size = settings.stt_model_size
        self.compute_type = settings.stt_compute_type

    def _ensure_whisper(self) -> Any:
        if self._whisper_model is None:
            from faster_whisper import WhisperModel  # type: ignore

            self._whisper_model = WhisperModel(
                self.model_size,
                device="cpu",
                compute_type=self.compute_type,
                cpu_threads=4,
            )
        return self._whisper_model

    def unload_models(self) -> None:
        self._whisper_model = None
        self._vad_model = None

    def get_status(self) -> Dict[str, Any]:
        faster_whisper_installed = False
        silero_installed = False
        try:
            import faster_whisper  # type: ignore # noqa: F401

            faster_whisper_installed = True
        except ImportError:
            pass
        try:
            import silero_vad  # type: ignore # noqa: F401

            silero_installed = True
        except ImportError:
            pass

        return {
            "engine": "faster-whisper",
            "installed": faster_whisper_installed,
            "loaded": self._whisper_model is not None,
            "model_size": self.model_size,
            "compute_type": self.compute_type,
            "vad_engine": "silero-vad" if silero_installed else "energy-vad",
            "silero_installed": silero_installed,
        }

    def transcribe_wav_bytes(
        self, wav_bytes: bytes, language: Optional[str] = None
    ) -> Dict[str, Any]:
        start = time.perf_counter()
        model = self._ensure_whisper()
        lang_arg = None if not language or language == "auto" else language

        audio_buf = io.BytesIO(wav_bytes)
        segments, info = model.transcribe(
            audio_buf,
            language=lang_arg,
            beam_size=1,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 450},
        )
        text_parts = [seg.text.strip() for seg in segments if seg.text.strip()]
        transcript = " ".join(text_parts).strip()
        duration_ms = (time.perf_counter() - start) * 1000.0
        return {
            "text": transcript,
            "language": getattr(info, "language", lang_arg or "en"),
            "language_probability": round(getattr(info, "language_probability", 1.0), 3),
            "duration_ms": round(duration_ms, 1),
        }

    def detect_speech_pcm16(self, pcm16_bytes: bytes, sample_rate: int = 16000) -> Dict[str, Any]:
        """Run Silero VAD if available, otherwise compute deterministic RMS energy VAD."""
        import struct

        samples = struct.unpack(f"<{len(pcm16_bytes) // 2}h", pcm16_bytes)
        if not samples:
            return {"speech": False, "probability": 0.0, "rms": 0.0}
        rms = (sum(s * s for s in samples) / len(samples)) ** 0.5 / 32768.0
        try:
            import numpy as np  # type: ignore
            import torch  # type: ignore
            from silero_vad import load_silero_vad  # type: ignore

            if self._vad_model is None:
                self._vad_model = load_silero_vad()
            tensor = torch.from_numpy(np.array(samples, dtype=np.float32) / 32768.0)
            prob = float(self._vad_model(tensor, sample_rate).item())
            return {"speech": prob >= 0.45, "probability": round(prob, 3), "rms": round(rms, 4)}
        except Exception:
            return {
                "speech": rms >= 0.018,
                "probability": round(min(1.0, rms * 18.0), 3),
                "rms": round(rms, 4),
            }

    @staticmethod
    def pcm16_to_wav(pcm16_bytes: bytes, sample_rate: int = 16000) -> bytes:
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(pcm16_bytes)
        return buf.getvalue()
