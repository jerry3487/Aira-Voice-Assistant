import { useEffect, useRef } from 'react';
import { STATE_META } from '../utils/voiceStateMachine.js';

const TONE_PALETTE = {
  neutral: { light: [51, 65, 85], dark: [148, 163, 184] },
  sky: { light: [2, 132, 199], dark: [56, 189, 248] },
  indigo: { light: [79, 70, 229], dark: [129, 140, 248] },
  amber: { light: [217, 119, 6], dark: [245, 158, 11] },
  emerald: { light: [5, 150, 105], dark: [16, 185, 129] },
  crimson: { light: [220, 38, 38], dark: [239, 68, 68] },
};

export default function VoiceOrb({
  state,
  audioLevel,
  spectrum,
  speechDetected,
  theme = 'dark',
  onClick,
}) {
  const canvasRef = useRef(null);
  const stateRef = useRef(state);
  const levelRef = useRef(audioLevel);
  const spectrumRef = useRef(spectrum);
  const themeRef = useRef(theme);

  const meta = STATE_META[state] || STATE_META.IDLE;
  const palette = TONE_PALETTE[meta.tone] || TONE_PALETTE.neutral;
  const activeRgb = theme === 'dark' ? palette.dark : palette.light;

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { levelRef.current = audioLevel; }, [audioLevel]);
  useEffect(() => { spectrumRef.current = spectrum; }, [spectrum]);
  useEffect(() => { themeRef.current = theme; }, [theme]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let rafId = null;
    let phase = 0;

    const draw = () => {
      const size = 276;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== size * dpr) {
        canvas.width = size * dpr;
        canvas.height = size * dpr;
      }
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, size, size);

      const st = stateRef.current;
      const isDark = themeRef.current === 'dark';
      const lvl = Math.min(1, (levelRef.current || 0) * 6.0);
      const bands = spectrumRef.current || [];
      const tone = (STATE_META[st] || STATE_META.IDLE).tone;
      const rgb = (TONE_PALETTE[tone] || TONE_PALETTE.neutral)[isDark ? 'dark' : 'light'];
      const [r, g, b] = rgb;

      const cx = size / 2;
      const cy = size / 2;
      const speed =
        st === 'SPEAKING'
          ? 0.065
          : st === 'THINKING' || st === 'TOOL_EXECUTING'
          ? 0.055
          : st === 'LISTENING'
          ? 0.032
          : 0.015;
      if (!prefersReduced) phase += speed;

      // 1. Calibrated Architectural Compass Dial (60 subtle precision ticks)
      const dialR = 122;
      for (let i = 0; i < 60; i += 1) {
        const ang = (i / 60) * Math.PI * 2 - Math.PI / 2;
        const isMajor = i % 15 === 0;
        const isMid = i % 5 === 0;
        const len = isMajor ? 8 : isMid ? 4.5 : 2;
        const x1 = cx + Math.cos(ang) * (dialR - len);
        const y1 = cy + Math.sin(ang) * (dialR - len);
        const x2 = cx + Math.cos(ang) * dialR;
        const y2 = cy + Math.sin(ang) * dialR;
        ctx.strokeStyle = isMajor
          ? `rgba(${r}, ${g}, ${b}, ${isDark ? 0.55 : 0.65})`
          : isDark
          ? 'rgba(255, 255, 255, 0.12)'
          : 'rgba(15, 23, 42, 0.14)';
        ctx.lineWidth = isMajor ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      // 2. Outer Hairline Orbit Track
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, 108, 0, Math.PI * 2);
      ctx.stroke();

      // 3. 32-Band Radial Acoustic Spectrum Petals
      const barCount = 32;
      const baseBarR = 76;
      for (let i = 0; i < barCount; i += 1) {
        const ang = (i / barCount) * Math.PI * 2 - Math.PI / 2 + phase * 0.15;
        const bandVal = bands[i] || 0;
        const syntheticWave =
          st === 'SPEAKING'
            ? 0.35 + 0.45 * Math.abs(Math.sin(phase * 2.2 + i * 0.45))
            : st === 'THINKING' || st === 'TOOL_EXECUTING'
            ? 0.22 + 0.28 * Math.sin(phase * 2.6 + i * 0.6)
            : st === 'LISTENING'
            ? Math.max(0.08, bandVal * 0.95 + lvl * 0.25)
            : 0.06;

        const barLen = 5 + Math.max(0, syntheticWave) * 24;
        const x1 = cx + Math.cos(ang) * baseBarR;
        const y1 = cy + Math.sin(ang) * baseBarR;
        const x2 = cx + Math.cos(ang) * (baseBarR + barLen);
        const y2 = cy + Math.sin(ang) * (baseBarR + barLen);

        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.32 + Math.min(0.65, syntheticWave * 0.7)})`;
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      // 4. Dual Counter-Rotating Harmonic Interference Ribbons
      for (let layer = 0; layer < 2; layer += 1) {
        const dir = layer === 0 ? 1 : -1;
        const radius = 56 - layer * 9;
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${layer === 0 ? 0.72 : 0.4})`;
        ctx.lineWidth = layer === 0 ? 1.75 : 1.25;
        ctx.beginPath();
        const pts = 72;
        for (let p = 0; p <= pts; p += 1) {
          const ang = (p / pts) * Math.PI * 2;
          const mod =
            st === 'SPEAKING'
              ? Math.sin(ang * 5 + phase * 2.4 * dir) * (4.5 + layer * 1.5)
              : st === 'LISTENING'
              ? Math.sin(ang * 4 + phase * 1.8 * dir) * (1.5 + lvl * 8.5)
              : st === 'THINKING' || st === 'TOOL_EXECUTING'
              ? Math.sin(ang * 6 + phase * 2.1 * dir) * 3.2
              : Math.sin(ang * 3 + phase * dir) * 1.1;
          const rad = radius + mod;
          const x = cx + Math.cos(ang) * rad;
          const y = cy + Math.sin(ang) * rad;
          if (p === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }

      // 5. Crisp Optical Aperture Core (Ceramic/Anodized Center)
      const coreR = 26 + (st === 'LISTENING' ? lvl * 7 : st === 'SPEAKING' ? Math.abs(Math.sin(phase * 2)) * 4 : 0);
      const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, coreR);
      grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${isDark ? 0.42 : 0.28})`);
      grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.04)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.85)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.stroke();

      // Center precision reticle dot
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.beginPath();
      ctx.arc(cx, cy, 3.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
      if (!prefersReduced) {
        rafId = requestAnimationFrame(draw);
      }
    };

    draw();
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  const meterPct = Math.min(100, Math.round((audioLevel || 0) * 1400));

  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        onClick={onClick}
        aria-label={`Voice assistant state: ${meta.label}. Click to toggle voice.`}
        data-testid="voice-orb-button"
        data-state={state}
        className="group relative flex h-[276px] w-[276px] items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-500"
      >
        <canvas
          ref={canvasRef}
          className="h-[276px] w-[276px] pointer-events-none"
          aria-hidden="true"
        />
      </button>

      <div className="mt-2 flex flex-col items-center text-center">
        <p
          data-testid="voice-state-label"
          className="font-display text-lg font-semibold tracking-tight"
          style={{ color: `rgb(${activeRgb.join(',')})` }}
        >
          {meta.label}
        </p>
        <p className="mt-1 max-w-xs text-xs text-slate-600 dark:text-slate-400">
          {meta.hint}
        </p>

        {/* Live VAD Energy Gate Meter */}
        <div className="mt-3 flex items-center gap-2.5">
          <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
            VAD Gate
          </span>
          <div className="relative h-1.5 w-36 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
            <div
              className={`h-full transition-[width] duration-75 ${
                speechDetected
                  ? 'bg-emerald-500'
                  : 'bg-sky-500 dark:bg-sky-400'
              }`}
              style={{ width: `${meterPct}%` }}
            />
            {/* VAD speech trigger threshold tick */}
            <div
              aria-hidden="true"
              className="absolute top-0 bottom-0 left-[22%] w-px bg-slate-500/70 dark:bg-white/50"
            />
          </div>
          <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300 tabular-nums">
            {speechDetected ? 'Voice' : 'Idle'}
          </span>
        </div>
      </div>
    </div>
  );
}
