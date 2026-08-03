"use client";

import { useEffect, useRef } from "react";

const VS_SOURCE = `
  attribute vec4 aVertexPosition;
  void main() { gl_Position = aVertexPosition; }
`;

const FS_SOURCE = `
  precision highp float;

  uniform vec2 u_resolution;
  uniform float u_time;
  uniform float u_ripple;
  uniform float u_intro;
  uniform float u_square;
  uniform float u_dark;
  uniform float u_bottom_fade;
  uniform float u_edges_only;
  uniform float u_rainbow;
  uniform float u_rave;    // 0..~1.6 brightness/coverage flash (e.g. fees landing)
  uniform float u_spread;  // 0 = thin edge band; →1 pulls the field toward center
  uniform float u_glow;    // multiplies dot brightness (1 = default, >1 = brighter)
  uniform float u_wave;    // 0..1 strength of a traveling diagonal brightness wave
  uniform float u_audio;   // 0..1 live audio energy — pulses the field to the track

  const vec3 bg_color      = vec3(0.992, 0.973, 0.941);
  const vec3 bg_dark       = vec3(0.059, 0.078, 0.098);
  const vec3 cloud_abyss   = vec3(0.05, 0.06, 0.10);
  const vec3 cloud_deep    = vec3(0.10, 0.12, 0.16);
  const vec3 cloud_mid     = vec3(0.16, 0.19, 0.25);
  const vec3 cloud_light   = vec3(0.26, 0.30, 0.38);
  const vec3 cloud_bright  = vec3(0.34, 0.38, 0.44);
  const vec3 cloud_purple  = vec3(0.32, 0.16, 0.42);
  const vec3 cloud_slate   = vec3(0.10, 0.16, 0.24);
  const vec3 cloud_violet  = vec3(0.49, 0.23, 0.93);
  const vec3 cloud_indigo  = vec3(0.42, 0.16, 0.85);
  const vec3 cloud_teal    = vec3(0.06, 0.22, 0.28);
  const vec3 cloud_ember   = vec3(0.32, 0.12, 0.06);
  const vec3 cloud_ice     = vec3(0.14, 0.24, 0.36);
  const vec3 cloud_bruise  = vec3(0.26, 0.08, 0.20);
  const vec3 cloud_moss    = vec3(0.12, 0.18, 0.10);
  const vec3 cloud_copper  = vec3(0.35, 0.20, 0.10);
  const vec3 purple_strong = vec3(0.486, 0.227, 0.929);
  const vec3 purple_mid    = vec3(0.427, 0.157, 0.851);
  const vec3 purple_soft   = vec3(0.545, 0.361, 0.965);
  const vec3 purple_deep   = vec3(0.380, 0.120, 0.780);
  const vec3 purple_ice    = vec3(0.700, 0.560, 0.980);

  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                        -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m;
    m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x  = a0.x * x0.x  + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    vec2 st = uv;
    st.x *= u_resolution.x / u_resolution.y;

    vec2 center = vec2(0.5);
    vec2 d = (uv - center) * vec2(1.8, 1.6);
    float circ_dist = length(d);
    float square_dist = max(abs(d.x), abs(d.y));
    float dist = mix(circ_dist, square_dist, u_square);

    float angle = atan(d.y, d.x);
    float wobble1 = snoise(vec2(angle * 2.0, u_time * 0.08)) * 0.12;
    float wobble2 = snoise(vec2(angle * 4.0 + 10.0, u_time * 0.05)) * 0.06;
    float tendril = snoise(uv * 6.0 + u_time * 0.06) * 0.1;

    float sweep_noise = snoise(vec2(angle * 3.0, u_time * 0.15 + 5.0)) * 0.15;
    float settled_inner = 0.55;
    float settled_outer = u_dark > 0.5 ? 0.88 : 0.85;
    float intro_inner = mix(1.3, settled_inner, u_intro) + sweep_noise * (1.0 - u_intro);
    float intro_outer = mix(1.6, settled_outer, u_intro) + sweep_noise * 0.5 * (1.0 - u_intro);

    float edge_mask = smoothstep(intro_inner + wobble1 + wobble2 + tendril, intro_outer, dist);

    if (u_bottom_fade > 0.001) {
      float dx = (uv.x - 0.5) * 2.5;
      float dy = uv.y * 3.0;
      float bc_dist = length(vec2(dx, dy));
      float proximity = 1.0 - smoothstep(0.0, 1.0, bc_dist);
      edge_mask *= mix(1.0, 1.0 - proximity, u_bottom_fade);
    }

    if (u_edges_only > 0.5) {
      // band hugging the four borders; u_spread pulls the inner edge toward the
      // center so the field can fill more of the screen (still densest at edges).
      vec2 ec = abs(uv - 0.5) * 2.0;
      float frame = max(ec.x, ec.y);
      float lo = mix(0.78, -1.0, clamp(u_spread, 0.0, 1.0));
      float frame_mask = smoothstep(lo, 0.99, frame);
      edge_mask *= frame_mask;
    }

    // while a track is playing, ease the field back from the centre a touch so the
    // player/content stays clearer there (no effect when paused — u_audio = 0)
    float centerness = 1.0 - smoothstep(0.0, 0.5, dist);
    edge_mask *= 1.0 - centerness * u_audio * 0.3;

    float gridDensity = 70.0;
    vec2 grid_st = fract(st * gridDensity);
    vec2 grid_id = floor(st * gridDensity);
    vec2 noise_pos = grid_id / gridDensity;

    float ripple_radius = (1.0 - u_ripple) * 1.2;
    float ripple_ring = abs(dist - ripple_radius);
    float ripple_effect = smoothstep(0.15, 0.0, ripple_ring) * u_ripple;
    vec2 ripple_push = normalize(uv - center + 0.001) * ripple_effect * 0.06;

    float n1 = snoise(noise_pos * 3.0 + u_time * 0.025 + ripple_push);
    float n2 = snoise(noise_pos * 5.0 - u_time * 0.015 + ripple_push * 0.7);
    float n3 = snoise(noise_pos * 1.5 + vec2(u_time * 0.01, -u_time * 0.02) + ripple_push * 0.4);

    float river1 = sin(n1 * 10.0 - u_time * 0.06);
    float river2 = sin(n2 * 8.0 + u_time * 0.04);
    float river3 = sin(n3 * 6.0 - u_time * 0.025);

    float combined = river1 * 0.5 + river2 * 0.3 + river3 * 0.2;

    float boosted_mask = min(edge_mask + ripple_effect * 0.4 + u_rave * 0.2 + u_audio * 0.5, 1.0);
    float base_size = smoothstep(-1.0, 1.0, combined) * 0.85 * (1.0 + u_audio * 0.9); // dots pump with the beat
    float size = base_size * boosted_mask;

    float hs = size / 2.0;
    vec2 bl = step(vec2(0.5 - hs), grid_st);
    vec2 tr = step(vec2(0.5 - hs), 1.0 - grid_st);
    float is_dot = bl.x * bl.y * tr.x * tr.y * step(0.01, edge_mask);

    float color_noise = snoise(noise_pos * 4.0 - u_time * 0.1) * 0.5 + 0.5;
    float intensity_noise = snoise(noise_pos * 7.0 + u_time * 0.06) * 0.5 + 0.5;
    float red_noise = snoise(noise_pos * 2.0 + vec2(u_time * 0.03, 0.0)) * 0.5 + 0.5;
    float teal_noise = snoise(noise_pos * 5.5 + vec2(u_time * 0.008, -u_time * 0.014)) * 0.5 + 0.5;
    float ember_noise = snoise(noise_pos * 3.0 + vec2(-u_time * 0.011, u_time * 0.007)) * 0.5 + 0.5;
    float hue_shift = snoise(noise_pos * 8.0 + vec2(u_time * 0.005, u_time * 0.009)) * 0.5 + 0.5;
    float region1 = snoise(noise_pos * 1.2 + vec2(u_time * 0.006, -u_time * 0.004)) * 0.5 + 0.5;
    float region2 = snoise(noise_pos * 1.8 + vec2(-u_time * 0.005, u_time * 0.008)) * 0.5 + 0.5;
    float crack_noise = snoise(noise_pos * 12.0 + vec2(u_time * 0.003, u_time * 0.006)) * 0.5 + 0.5;
    float moss_noise = snoise(noise_pos * 2.5 + vec2(u_time * 0.009, -u_time * 0.006)) * 0.5 + 0.5;

    if (u_rainbow > 0.5) {
      vec3 base = vec3(0.0);
      if (is_dot > 0.0) {
        float hue = fract(uv.x * 0.8 + u_time * 0.03 + (color_noise - 0.5) * 0.18 + u_rave * 0.06);
        vec3 dot_col = hsv2rgb(vec3(hue, 0.85, 1.0));
        float fade = edge_mask * edge_mask * edge_mask;
        float opacity = size * mix(0.45, 1.0, intensity_noise) * fade;
        // traveling diagonal wave of extra brightness sweeping across the field
        float wave = pow(sin((uv.x + uv.y) * 3.0 - u_time * 0.7) * 0.5 + 0.5, 3.0);
        opacity *= u_glow * (1.0 + u_wave * wave * 1.4); // brighter glow + the wave
        opacity = min(1.0, opacity * (1.0 + u_rave * 1.8) * (1.0 + u_audio * 2.8)); // fees + the track pulse the field
        if (u_dark > 1.5) {
          gl_FragColor = vec4(mix(base, dot_col, opacity), 1.0);
        } else {
          gl_FragColor = vec4(dot_col, opacity);
        }
      } else {
        gl_FragColor = (u_dark > 1.5) ? vec4(base, 1.0) : vec4(0.0, 0.0, 0.0, 0.0);
      }
    } else if (u_dark > 1.5) {
      vec3 final_color = bg_dark;
      if (is_dot > 0.0) {
        vec3 base_warm = mix(cloud_deep, cloud_mid, color_noise);
        vec3 base_cool = mix(cloud_abyss, cloud_slate, intensity_noise);
        vec3 base_bright = mix(cloud_mid, cloud_light, hue_shift);
        vec3 base_vivid = mix(cloud_light, cloud_bright, crack_noise);
        vec3 dot_col = mix(
          mix(base_warm, base_cool, region1),
          mix(base_bright, base_vivid, region1),
          smoothstep(0.3, 0.7, region2)
        );

        dot_col = mix(dot_col, cloud_purple, smoothstep(0.35, 0.75, red_noise) * 0.7);
        dot_col = mix(dot_col, cloud_teal, smoothstep(0.5, 0.8, teal_noise) * smoothstep(0.3, 0.6, region1) * 0.25);
        dot_col = mix(dot_col, cloud_ember, smoothstep(0.55, 0.85, ember_noise) * smoothstep(0.5, 0.8, region2) * 0.25);
        dot_col = mix(dot_col, cloud_ice, smoothstep(0.6, 0.85, hue_shift) * smoothstep(0.4, 0.7, teal_noise) * 0.25);
        dot_col = mix(dot_col, cloud_bruise, smoothstep(0.5, 0.8, red_noise) * smoothstep(0.45, 0.7, ember_noise) * 0.45);
        dot_col = mix(dot_col, cloud_moss, smoothstep(0.55, 0.85, moss_noise) * smoothstep(0.4, 0.65, region1) * 0.18);
        dot_col = mix(dot_col, cloud_copper, smoothstep(0.6, 0.9, crack_noise) * smoothstep(0.55, 0.8, ember_noise) * 0.18);
        dot_col *= 1.0 + (crack_noise - 0.5) * 0.15;

        float swirl1 = snoise(noise_pos * 3.5 + vec2(u_time * 0.02, u_time * -0.015));
        float swirl2 = snoise(noise_pos * 6.0 + vec2(-u_time * 0.012, u_time * 0.025));
        float violet_mask = smoothstep(-0.05, 0.45, swirl1) * smoothstep(-0.1, 0.4, swirl2);
        vec3 violet_tone = mix(cloud_indigo, cloud_violet, swirl1 * 0.5 + 0.5);
        dot_col = mix(dot_col, violet_tone, violet_mask * 0.85);

        float fade = edge_mask * edge_mask * edge_mask;
        float opacity = size * mix(0.30, 0.75, intensity_noise) * fade;
        final_color = mix(bg_dark, dot_col, opacity);
      }
      gl_FragColor = vec4(final_color, 1.0);
    } else if (u_dark > 0.5) {
      if (is_dot > 0.0) {
        vec3 bw = mix(cloud_deep, cloud_mid, color_noise);
        vec3 bc = mix(cloud_abyss, cloud_slate, intensity_noise);
        vec3 bb = mix(cloud_mid, cloud_light, hue_shift);
        vec3 bv = mix(cloud_light, cloud_bright, crack_noise);
        vec3 dot_col = mix(mix(bw, bc, region1), mix(bb, bv, region1), smoothstep(0.3, 0.7, region2));
        dot_col = mix(dot_col, cloud_purple, smoothstep(0.45, 0.75, red_noise) * 0.45);
        dot_col = mix(dot_col, cloud_teal, smoothstep(0.5, 0.8, teal_noise) * smoothstep(0.3, 0.6, region1) * 0.5);
        dot_col = mix(dot_col, cloud_ember, smoothstep(0.55, 0.85, ember_noise) * smoothstep(0.5, 0.8, region2) * 0.45);
        dot_col = mix(dot_col, cloud_ice, smoothstep(0.6, 0.85, hue_shift) * smoothstep(0.4, 0.7, teal_noise) * 0.4);
        dot_col = mix(dot_col, cloud_bruise, smoothstep(0.5, 0.8, red_noise) * smoothstep(0.45, 0.7, ember_noise) * 0.35);
        dot_col = mix(dot_col, cloud_moss, smoothstep(0.55, 0.85, moss_noise) * smoothstep(0.4, 0.65, region1) * 0.3);
        dot_col = mix(dot_col, cloud_copper, smoothstep(0.6, 0.9, crack_noise) * smoothstep(0.55, 0.8, ember_noise) * 0.3);
        dot_col *= 1.0 + (crack_noise - 0.5) * 0.15;
        float swirl1 = snoise(noise_pos * 3.5 + vec2(u_time * 0.02, u_time * -0.015));
        float swirl2 = snoise(noise_pos * 6.0 + vec2(-u_time * 0.012, u_time * 0.025));
        float violet_mask = smoothstep(0.15, 0.55, swirl1) * smoothstep(0.1, 0.5, swirl2);
        dot_col = mix(dot_col, mix(cloud_indigo, cloud_violet, swirl1 * 0.5 + 0.5), violet_mask * 0.55);
        float fade = edge_mask * edge_mask * edge_mask;
        float a = size * mix(0.25, 0.65, intensity_noise) * fade;
        gl_FragColor = vec4(dot_col, a);
      } else {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
      }
    } else {
      vec3 final_color = bg_color;
      if (is_dot > 0.0) {
        vec3 dot_col;
        if (intensity_noise > 0.7) {
          dot_col = mix(purple_strong, purple_mid, color_noise);
        } else if (intensity_noise > 0.4) {
          dot_col = mix(purple_mid, purple_soft, color_noise);
        } else {
          dot_col = mix(purple_soft, purple_ice, color_noise);
        }
        dot_col = mix(dot_col, purple_deep, smoothstep(0.65, 0.85, red_noise) * 0.35);
        float fade = edge_mask * edge_mask * edge_mask;
        float opacity = size * mix(0.20, 0.70, intensity_noise) * fade;
        final_color = mix(bg_color, dot_col, opacity);
      }
      gl_FragColor = vec4(final_color, 1.0);
    }
  }
`;

function loadShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("Shader compile error:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function initProgram(gl: WebGLRenderingContext) {
  const vs = loadShader(gl, gl.VERTEX_SHADER, VS_SOURCE);
  const fs = loadShader(gl, gl.FRAGMENT_SHADER, FS_SOURCE);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("Program link error:", gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

const CANVAS_ID = "pulse-animated-bg";

interface AnimatedBgProps {
  variant?: "circle" | "square";
  dark?: boolean;
  darkOpaque?: boolean;
  zIndex?: number;
  opacity?: number;
  edgesOnly?: boolean;
  rainbow?: boolean;
  fadeInDelayMs?: number; // delay the canvas fade-in + intro sweep (page-load cascade)
  spread?: number; // 0 = thin edge band (edgesOnly); →1 pulls the field toward center
  pulse?: number; // bump this (e.g. a fee counter) to flash / "rave" the field
  glow?: number; // dot brightness multiplier (1 = default, >1 = brighter/bloomier)
  wave?: number; // 0..1 strength of a traveling diagonal brightness wave
  getAudioLevel?: () => number; // sampled each frame: live audio energy 0..1 (drives the field to the track)
}

export function AnimatedBg({
  variant = "circle",
  dark = false,
  darkOpaque = false,
  zIndex,
  opacity,
  edgesOnly = false,
  rainbow = false,
  fadeInDelayMs = 0,
  spread = 0,
  pulse = 0,
  glow = 1,
  wave = 0,
  getAudioLevel,
}: AnimatedBgProps) {
  const isSquare = variant === "square";
  const darkMode = darkOpaque ? 2 : dark ? 1 : 0;
  const useAlpha = darkMode === 1;

  // Flash state lives in refs so the render loop reads live values without the
  // WebGL context being torn down every time `pulse` changes.
  const raveRef = useRef(0);
  const rippleRef = useRef(0);
  const prevPulseRef = useRef(pulse);
  const spreadRef = useRef(spread);
  const glowRef = useRef(glow);
  const waveRef = useRef(wave);
  const audioFnRef = useRef(getAudioLevel);
  audioFnRef.current = getAudioLevel; // latest audio sampler, called each frame
  const audioSmoothRef = useRef(0);

  // Mirror the live-tunable props into refs so the render loop reads them without
  // rebuilding the WebGL context (and keeps the effect's dependency list stable).
  useEffect(() => {
    spreadRef.current = spread;
    glowRef.current = glow;
    waveRef.current = wave;
  }, [spread, glow, wave]);

  // Each new pulse spikes the rave (stacks during fee bursts) and kicks an
  // expanding ripple ring out from the center.
  useEffect(() => {
    if (pulse === prevPulseRef.current) return;
    prevPulseRef.current = pulse;
    raveRef.current = Math.min(raveRef.current + 1, 1.6);
    rippleRef.current = 1;
  }, [pulse]);

  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.id = CANVAS_ID;
    const resolvedZ = zIndex != null ? String(zIndex) : darkMode > 0 ? "45" : "0";
    const prefersReduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const introDelay = prefersReduced ? 0 : fadeInDelayMs;
    const opacityStr = opacity != null ? `opacity:${opacity};` : "";
    const fadeCss = introDelay > 0 ? `opacity:0;animation:bg-load 1100ms ease-out ${introDelay}ms forwards;` : opacityStr;
    canvas.style.cssText = `position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:${resolvedZ};${fadeCss}`;
    canvas.setAttribute("aria-hidden", "true");
    document.body.prepend(canvas);

    let removed = false;
    const onContextLost = (e: Event) => { e.preventDefault(); removed = true; };
    canvas.addEventListener("webglcontextlost", onContextLost);

    const gl = canvas.getContext("webgl", { antialias: false, alpha: useAlpha });
    if (!gl) { canvas.remove(); return; }

    if (useAlpha) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }

    const program = initProgram(gl);
    if (!program) { canvas.remove(); return; }

    const vertexPos = gl.getAttribLocation(program, "aVertexPosition");
    const uResolution = gl.getUniformLocation(program, "u_resolution");
    const uTime = gl.getUniformLocation(program, "u_time");
    const uRipple = gl.getUniformLocation(program, "u_ripple");
    const uIntro = gl.getUniformLocation(program, "u_intro");
    const uSquare = gl.getUniformLocation(program, "u_square");
    const uDark = gl.getUniformLocation(program, "u_dark");
    const uBottomFade = gl.getUniformLocation(program, "u_bottom_fade");
    const uEdgesOnly = gl.getUniformLocation(program, "u_edges_only");
    const uRainbow = gl.getUniformLocation(program, "u_rainbow");
    const uRave = gl.getUniformLocation(program, "u_rave");
    const uSpread = gl.getUniformLocation(program, "u_spread");
    const uGlow = gl.getUniformLocation(program, "u_glow");
    const uWave = gl.getUniformLocation(program, "u_wave");
    const uAudio = gl.getUniformLocation(program, "u_audio");

    let introStart = Date.now() + introDelay;
    const INTRO_DURATION = darkMode > 0 ? 1600 : isSquare ? 1200 : 2800;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([1, 1, -1, 1, 1, -1, -1, -1]), gl.STATIC_DRAW);

    let start = Date.now();
    let raf = 0;

    function render() {
      if (removed) { cancelAnimationFrame(raf); return; }
      try {
        const dpr = Math.min(window.devicePixelRatio, 1.5);
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
          canvas.width = w * dpr;
          canvas.height = h * dpr;
          gl!.viewport(0, 0, canvas.width, canvas.height);
        }

        if (useAlpha) { gl!.clearColor(0, 0, 0, 0); gl!.clear(gl!.COLOR_BUFFER_BIT); }

        gl!.useProgram(program);
        gl!.bindBuffer(gl!.ARRAY_BUFFER, buf);
        gl!.vertexAttribPointer(vertexPos, 2, gl!.FLOAT, false, 0, 0);
        gl!.enableVertexAttribArray(vertexPos);

        const introElapsed = Date.now() - introStart;
        const introRaw = Math.min(Math.max(introElapsed, 0) / INTRO_DURATION, 1.0);
        const intro = 1.0 - Math.pow(1.0 - introRaw, 3);

        const time = (Date.now() - start) / 1000;

        gl!.uniform2f(uResolution, canvas.width, canvas.height);
        gl!.uniform1f(uTime, time);
        gl!.uniform1f(uRipple, rippleRef.current);
        gl!.uniform1f(uIntro, intro);
        gl!.uniform1f(uSquare, isSquare ? 1.0 : 0.0);
        gl!.uniform1f(uDark, darkMode as number);
        gl!.uniform1f(uBottomFade, 0);
        gl!.uniform1f(uEdgesOnly, edgesOnly ? 1.0 : 0.0);
        gl!.uniform1f(uRainbow, rainbow ? 1.0 : 0.0);
        gl!.uniform1f(uRave, raveRef.current);
        gl!.uniform1f(uSpread, spreadRef.current);
        gl!.uniform1f(uGlow, glowRef.current);
        gl!.uniform1f(uWave, waveRef.current);
        const audioTarget = Math.max(0, Math.min(1, audioFnRef.current ? audioFnRef.current() || 0 : 0));
        // fast attack, slow release → a punchy "pump" that's easy to see on the beat
        audioSmoothRef.current += (audioTarget - audioSmoothRef.current) * (audioTarget > audioSmoothRef.current ? 0.5 : 0.12);
        gl!.uniform1f(uAudio, audioSmoothRef.current);

        rippleRef.current *= 0.96; // ripple ring expands as it decays
        raveRef.current *= 0.95;   // flash fades over ~0.5s, restacks on bursts
        gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
      } catch {
        removed = true;
        return;
      }
      raf = document.hidden ? 0 : requestAnimationFrame(render);
    }

    render();

    // Pause the loop while the tab is hidden. A tab playing audio (the radio)
    // is NOT throttled by the browser, so an uncapped rAF would keep the GPU
    // busy in the background. Shift the clock forward by the hidden span on
    // return so the field resumes smoothly instead of jumping.
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.hidden) {
        if (!hiddenAt) hiddenAt = Date.now();
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        return;
      }
      // becoming visible
      if (hiddenAt) {
        // was running, then hidden — keep the clock continuous across the gap
        const gap = Date.now() - hiddenAt;
        start += gap;
        introStart += gap;
        hiddenAt = 0;
      } else if (!raf) {
        // loaded while hidden (rAF never ran, e.g. opened in a background tab) —
        // start the intro fresh the first time the tab is actually shown
        start = Date.now();
        introStart = Date.now() + introDelay;
      }
      if (!removed && !raf) raf = requestAnimationFrame(render);
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      if (!removed) canvas.remove();
      removed = true;
    };
  }, [isSquare, darkMode, useAlpha, zIndex, opacity, edgesOnly, rainbow, fadeInDelayMs]);

  return null;
}
