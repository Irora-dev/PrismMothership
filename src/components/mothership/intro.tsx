"use client";

import { useEffect, useRef, useState } from "react";
import { C, MONO } from "./style";

// ── The boot sequence: AURA COALESCENCE ──────────────────────────────────────
// the designer's chosen intro (2026-08-03, his Three.js mockup): a domain-warped
// glossy ribbon ring coalesces in a HUD frame, then the title lands and the
// whole thing fades to reveal the page. Ported to RAW WebGL — the mockup's
// Three.js only drew one fullscreen quad, so the dependency stays out of the
// bundle. Shader body is his, verbatim, except the palette (tuned from
// pink/red to the Mothership accents) and the 15s formation compressed to ~4s
// per his "brief, a few secs" spec.
//
// Plays once per visit (sessionStorage). Click skips. prefers-reduced-motion
// or missing WebGL skip it entirely.

const INTRO_KEY = "ms-intro-played";
const FORMATION_MS = 3800;
const FADE_AT_MS = 4200;
const GONE_AT_MS = 5000;

const VERT = `
attribute vec2 a;
varying vec2 vUv;
void main() {
  vUv = a * 0.5 + 0.5;
  gl_Position = vec4(a, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_formation_progress;
varying vec2 vUv;

void main() {
  vec2 uv = (vUv - 0.5) * 2.0;
  uv.x *= u_resolution.x / u_resolution.y;

  float t = u_time * 0.4;
  float form = u_formation_progress;

  vec2 p = uv;

  // overarching rotation of the whole field
  float s = sin(t * 0.2);
  float c = cos(t * 0.2);
  p *= mat2(c, -s, s, c);

  // domain warping for organic, fluid ribbon distortion
  for (float i = 1.0; i <= 3.0; i++) {
    vec2 newp = p;
    newp.x += 0.3 / i * sin(i * 3.0 * p.y + t + i);
    newp.y += 0.3 / i * cos(i * 2.0 * p.x + t + i);
    p = newp;
  }

  float d = length(p);

  // a smooth, thick ring that coalesces tightly
  float radius = mix(0.7, 0.3, form);
  float ring = abs(d - radius);

  float band1 = smoothstep(0.15, 0.0, ring);
  float band2 = smoothstep(0.3, 0.0, ring) * 0.5;
  float glow = 0.02 / (ring + 0.01);

  // the Mothership palette (the mockup's pink/red, re-tuned to brand)
  vec3 cyan = vec3(0.0, 0.94, 1.0);
  vec3 green = vec3(0.0, 1.0, 0.53);
  vec3 purple = vec3(0.62, 0.0, 1.0);
  vec3 orange = vec3(1.0, 0.37, 0.0);

  float angle = atan(p.y, p.x);
  vec3 col = mix(cyan, green, sin(angle * 2.0 + t) * 0.5 + 0.5);
  col = mix(col, orange, cos(p.x * 4.0 - t) * 0.5 + 0.5);
  col = mix(col, purple, sin(d * 5.0 + t) * 0.5 + 0.5);

  // specular highlights for the glossy 3D feel
  float spec = pow(max(0.0, sin(ring * 40.0 - t * 6.0)), 32.0);
  float spec2 = pow(max(0.0, cos(angle * 5.0 + t * 2.0)), 16.0);

  vec3 final = col * (band1 + band2 + glow);
  final += vec3(1.0) * spec * band1;
  final += cyan * spec2 * glow * 0.5;

  // deep void behind
  vec3 bg = mix(vec3(0.0, 0.0, 0.02), purple * 0.1, smoothstep(2.0, 0.0, length(uv)));
  final += bg * (1.0 - band1);

  // vignette
  final *= smoothstep(2.0, 0.4, length(uv));

  gl_FragColor = vec4(final, 1.0);
}`;

function easeInOutQuad(x: number): number {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

export function MothershipIntro() {
  const [stage, setStage] = useState<"done" | "boot" | "fade">("done");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const statusTextRef = useRef<HTMLSpanElement>(null);
  const statusDotRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const cohesionRef = useRef<HTMLSpanElement>(null);

  // Start "done" and flip on in an effect so SSR hydration always matches.
  // The flag is only written at COMPLETION (or skip) — writing it up front made
  // the effect non-idempotent, and strict mode's double-invoke left the intro
  // running forever with no timers (caught by the timecode in a screenshot).
  //
  // The pre-paint black cover (html[data-ms-boot], stamped by layout.tsx's
  // blocking script) is lifted here: instantly when the intro won't play,
  // otherwise two frames after the overlay mounts so black hands off to black
  // and the site never peeks through (the designer, 2026-08-03).
  useEffect(() => {
    const liftCover = () => document.documentElement.removeAttribute("data-ms-boot");
    if (sessionStorage.getItem(INTRO_KEY)) {
      liftCover();
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      sessionStorage.setItem(INTRO_KEY, "1");
      liftCover();
      return;
    }
    setStage("boot");
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(liftCover);
    });
    const t1 = setTimeout(() => setStage("fade"), FADE_AT_MS);
    const t2 = setTimeout(() => {
      sessionStorage.setItem(INTRO_KEY, "1");
      setStage("done");
    }, GONE_AT_MS);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  const skip = () => {
    sessionStorage.setItem(INTRO_KEY, "1");
    setStage("done");
  };

  // the shader loop — raw WebGL, one fullscreen triangle. Keyed on a boolean
  // so boot→fade does NOT re-init the context mid-fade; it runs once and dies
  // when the overlay unmounts.
  const active = stage !== "done";
  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
    if (!gl) {
      setStage("done"); // no WebGL → no intro
      return;
    }

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      setStage("done");
      return;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(prog, "u_time");
    const uRes = gl.getUniformLocation(prog, "u_resolution");
    const uForm = gl.getUniformLocation(prog, "u_formation_progress");

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const resize = () => {
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(uRes, canvas.width, canvas.height);
    };
    resize();
    window.addEventListener("resize", resize);

    const start = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const elapsed = now - start;
      const progress = easeInOutQuad(Math.min(elapsed / FORMATION_MS, 1));
      gl.uniform1f(uTime, elapsed * 0.001);
      gl.uniform1f(uForm, progress);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // HUD readouts — driven directly, no React churn at 60fps
      if (timeRef.current) {
        const ms = Math.floor((elapsed % 1000) / 10);
        const sec = Math.floor((elapsed / 1000) % 60);
        timeRef.current.innerText = `00:00:${sec.toString().padStart(2, "0")}:${ms.toString().padStart(2, "0")}`;
      }
      if (cohesionRef.current) {
        cohesionRef.current.innerText = `${Math.min(99.9, progress * 100).toFixed(2)}%`;
      }
      if (statusTextRef.current && statusDotRef.current) {
        const [text, color] =
          progress < 0.3
            ? ["DETECTING SIGNAL", C.orange]
            : progress < 0.7
              ? ["COALESCENCE IN PROGRESS", C.orange]
              : progress < 0.95
                ? ["CORE IGNITION DETECTED", "#ffffff"]
                : ["MOTHERSHIP ONLINE", C.cyan];
        statusTextRef.current.innerText = text;
        statusDotRef.current.style.backgroundColor = color;
        statusDotRef.current.style.boxShadow = `0 0 8px ${color}`;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  if (stage === "done") return null;

  const hud: React.CSSProperties = {
    fontFamily: MONO,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.2em",
    lineHeight: 1.4,
    textShadow: `0 0 6px ${C.cyan}66`,
    color: "rgba(255,255,255,0.85)",
  };
  const corner = (pos: React.CSSProperties, borderWidth: string): React.CSSProperties => ({
    position: "absolute",
    width: 16,
    height: 16,
    borderColor: `${C.cyan}99`,
    borderStyle: "solid",
    opacity: 0.8,
    boxShadow: `0 0 8px ${C.cyan}4d`,
    borderWidth,
    ...pos,
  });

  return (
    <div
      onClick={skip}
      className="fixed inset-0 z-[100] cursor-pointer transition-opacity duration-700"
      style={{ background: "#000", opacity: stage === "fade" ? 0 : 1, pointerEvents: stage === "fade" ? "none" : "auto" }}
      aria-hidden
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* travelling scanline */}
      <div
        className="pointer-events-none absolute left-0 top-0 h-[2px] w-full"
        style={{
          background: `linear-gradient(to right, transparent, ${C.cyan}4d, ${C.purple}4d, transparent)`,
          animation: "ms-scan 6s linear infinite",
        }}
      />

      {/* HUD frame */}
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-6">
        <header className="flex items-start justify-between">
          <div style={hud}>
            <span className="flex items-center gap-2">
              <div ref={statusDotRef} className="h-1 w-1 rounded-full" style={{ background: C.orange, animation: "live-pulse 1s infinite" }} />
              <span ref={statusTextRef}>DETECTING SIGNAL</span>
            </span>
            <span className="mt-1 block opacity-60">PRISM_MOTHERSHIP.V2</span>
          </div>
          <div style={{ ...hud, textAlign: "right", opacity: 0.6 }}>
            REC
            <br />
            <span ref={timeRef}>00:00:00:00</span>
          </div>
        </header>

        <footer className="flex items-end justify-between">
          <div style={{ ...hud, opacity: 0.6 }}>
            AURAL
            <br />
            SPECTROMETRY
          </div>
          <div style={hud} className="flex items-baseline gap-4">
            <span style={{ opacity: 0.6 }}>COHESION</span>
            <span ref={cohesionRef} style={{ fontVariantNumeric: "tabular-nums", minWidth: 60 }}>
              0.00%
            </span>
          </div>
        </footer>
      </div>

      {/* center reticle */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-[340px] w-[240px] -translate-x-1/2 -translate-y-1/2 sm:h-[400px] sm:w-[280px]"
        style={{ border: `1px solid ${C.cyan}0d`, boxShadow: `inset 0 0 40px ${C.cyan}05` }}
      >
        <div style={corner({ top: -1, left: -1 }, "2px 0 0 2px")} />
        <div style={corner({ top: -1, right: -1 }, "2px 2px 0 0")} />
        <div style={corner({ bottom: -1, left: -1 }, "0 0 2px 2px")} />
        <div style={corner({ bottom: -1, right: -1 }, "0 2px 2px 0")} />
        <div className="absolute left-1/2 top-1/2 h-[10px] w-px -translate-x-1/2 -translate-y-1/2 bg-white/50" style={{ boxShadow: `0 0 4px ${C.cyan}66` }} />
        <div className="absolute left-1/2 top-1/2 h-px w-[10px] -translate-x-1/2 -translate-y-1/2 bg-white/50" style={{ boxShadow: `0 0 4px ${C.cyan}66` }} />
      </div>

      {/* the title lands as the ring stabilizes */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[18%] flex flex-col items-center px-6 text-center">
        <h1
          className="text-2xl font-black tracking-[0.2em] text-white sm:text-3xl"
          style={{
            textShadow: `0 2px 24px rgba(0,0,0,0.95), 0 0 8px rgba(0,0,0,0.9), 0 0 30px ${C.cyan}59`,
            animation: "ms-intro-in 0.8s cubic-bezier(0.16,1,0.3,1) 2.9s both",
          }}
        >
          THE PRISM MOTHERSHIP
        </h1>
        <p
          className="mt-3 text-[11px] uppercase tracking-[0.3em] text-slate-300"
          style={{
            textShadow: "0 1px 12px rgba(0,0,0,0.95), 0 0 6px rgba(0,0,0,0.9)",
            animation: "ms-intro-in 0.7s ease-out 3.3s both",
          }}
        >
          The app store built on PRISM
        </p>
      </div>
    </div>
  );
}
