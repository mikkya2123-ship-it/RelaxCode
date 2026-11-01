"use client";

import { useEffect, useRef, useState } from "react";
import { createRenderer } from "./optimized-black-hole-utils/renderer";

/**
 * The optimized black hole: a ray-marched WebGL shader with gravitational
 * lensing. The host verifies that the GL context actually presents pixels —
 * transparent Electron windows on Windows sometimes compile fine and draw
 * nothing — and falls back to an equivalent Canvas2D scene when they do not.
 */
export function OptimizedBlackHole() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isReady, setIsReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = createRenderer({ canvas });
    void renderer.ready.then((ok) => {
      if (cancelled) return;
      if (ok) setIsReady(true);
      else {
        console.warn("[black-hole] webgl presents no pixels, using the canvas2d fallback");
        setFailed(true);
      }
    });
    return () => {
      cancelled = true;
      renderer.dispose();
    };
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {failed ? (
        <Canvas2DBlackHole />
      ) : (
        <canvas
          ref={canvasRef}
          className={`block h-full w-full touch-none transition-opacity duration-500 ${
            isReady ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * Canvas2D fallback
 *
 * The same scene — black horizon, white-hot photon ring, tilted turbulent
 * disk with doppler shading, lensed halo over the hole — without WebGL, so a
 * dead context can never leave the menu black.
 * ------------------------------------------------------------------------- */

function Canvas2DBlackHole() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      w = Math.max(1, Math.round(el.clientWidth * dpr));
      h = Math.max(1, Math.round(el.clientHeight * dpr));
      if (el.width !== w || el.height !== h) {
        el.width = w;
        el.height = h;
      }
    };
    resize();

    const scale = () => Math.min(w, h) * 0.46;
    const cx = () => w / 2;
    const cy = () => h * 0.52;

    // Static starfield layer.
    const stars = document.createElement("canvas");
    stars.width = w;
    stars.height = h;
    const sctx = stars.getContext("2d");
    if (sctx) {
      sctx.fillStyle = "#010103";
      sctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 90; i++) {
        const r = (Math.random() * 0.9 + 0.3) * dpr;
        sctx.fillStyle = `rgba(215,225,255,${Math.random() * 0.4 + 0.08})`;
        sctx.beginPath();
        sctx.arc(Math.random() * w, Math.random() * h, r, 0, Math.PI * 2);
        sctx.fill();
      }
    }

    interface Particle {
      r: number;
      a0: number;
      speed: number;
      size: number;
    }
    const particles: Particle[] = [];
    for (let i = 0; i < 190; i++) {
      const r = 0.32 + Math.pow(Math.random(), 1.7) * 0.58;
      particles.push({
        r,
        a0: Math.random() * Math.PI * 2,
        speed: 0.9 / Math.pow(r, 1.5),
        size: (Math.random() * 0.9 + 0.4) * dpr,
      });
    }

    const TILT = -0.34;
    const SQUASH = 0.24;

    const drawParticle = (p: Particle, ang: number, t: number) => {
      const wob = 0.92 + 0.08 * Math.sin(t * 1.6 + p.r * 9.0);
      const ox = Math.cos(ang) * p.r * scale();
      const oy = Math.sin(ang) * p.r * scale() * SQUASH * wob;
      const x = cx() + ox * Math.cos(TILT) - oy * Math.sin(TILT);
      const y = cy() + ox * Math.sin(TILT) + oy * Math.cos(TILT);
      const heat = Math.max(0, 1 - (p.r - 0.32) / 0.58);
      // Doppler: the left, approaching side burns brighter and whiter.
      const b = (0.55 + 0.45 * Math.max(0, Math.sin(ang + Math.PI))) * (0.3 + 0.85 * heat);
      const cr = 255;
      const cg = Math.round(200 + 55 * heat);
      const cb = Math.round(135 + 115 * heat * heat);
      const rad = p.size * (1.2 + heat * 1.4);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, rad);
      grad.addColorStop(0, `rgba(${cr},${cg},${cb},${0.8 * b})`);
      grad.addColorStop(0.45, `rgba(${cr},${cg},${cb},${0.26 * b})`);
      grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    };

    let raf = 0;
    const draw = (now: number) => {
      resize();
      const t = now / 1000;
      const S = scale();
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(stars, 0, 0);

      // The lensed halo: the far side of the disk bent over the top.
      ctx.globalCompositeOperation = "lighter";
      const halo = ctx.createRadialGradient(cx(), cy(), S * 0.16, cx(), cy(), S * 0.42);
      halo.addColorStop(0, "rgba(255,235,205,0)");
      halo.addColorStop(0.35, "rgba(255,225,185,0.16)");
      halo.addColorStop(0.75, "rgba(255,190,120,0.06)");
      halo.addColorStop(1, "rgba(255,170,90,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx(), cy(), S * 0.42, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalCompositeOperation = "lighter";
      for (const p of particles) {
        const ang = p.a0 + t * p.speed;
        if (Math.sin(ang) >= 0) continue; // near side: second pass
        drawParticle(p, ang, t);
      }

      // Photon ring.
      const ringR = 0.21 * S;
      const ring = ctx.createRadialGradient(cx(), cy(), ringR * 0.9, cx(), cy(), ringR * 1.2);
      ring.addColorStop(0, "rgba(255,246,228,0)");
      ring.addColorStop(0.42, "rgba(255,246,228,0.9)");
      ring.addColorStop(0.58, "rgba(255,220,160,0.5)");
      ring.addColorStop(1, "rgba(255,190,110,0)");
      ctx.fillStyle = ring;
      ctx.beginPath();
      ctx.arc(cx(), cy(), ringR * 1.2, 0, Math.PI * 2);
      ctx.fill();

      // Event horizon.
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.arc(cx(), cy(), 0.18 * S, 0, Math.PI * 2);
      ctx.fill();

      // Near side of the disk, in front of the hole.
      ctx.globalCompositeOperation = "lighter";
      for (const p of particles) {
        const ang = p.a0 + t * p.speed;
        if (Math.sin(ang) < 0) continue;
        drawParticle(p, ang, t);
      }
      ctx.globalCompositeOperation = "source-over";

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} className="block h-full w-full touch-none" />;
}

export default OptimizedBlackHole;
