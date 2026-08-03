"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AnimatedBg } from "@/components/effects/animated-bg";
import { MothershipShell } from "@/components/mothership/shell";
import { Visualizer } from "@/components/radio/visualizer";
import { ReactiveRainbow } from "@/components/radio/reactive-rainbow";
import { FeeStreaks } from "@/components/radio/fee-streaks";
import { PixelRainbow } from "@/components/effects/pixel-rainbow";
import { useRadio } from "@/components/radio/radio-provider";
import { StartRadioButton } from "@/components/radio/start-radio";
import { useActivityFeed } from "@/hooks/useActivityFeed";
import { STATIONS } from "@/lib/radio/stations";
import { C, MONO, glass, glow } from "@/components/mothership/style";
import { fmtPrism, fmtUsd } from "@/lib/feed/format";

function EqBars({ color }: { color: string }) {
  return (
    <span className="flex items-end gap-[2px] h-3.5 shrink-0" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="w-[2.5px] rounded-full"
          style={{ height: "100%", background: color, transformOrigin: "bottom", animation: `radio-eq 0.9s ease-in-out ${i * 0.15}s infinite` }}
        />
      ))}
    </span>
  );
}

function hashCode(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// Rainbow activity sparkline — one bar per fee, newest at the right, building up
// as fees land. Bars are sqrt-scaled so tiny fees still register.
function ActivitySpark({ data }: { data: number[] }) {
  const raw = useId();
  const id = "as" + raw.replace(/[^a-zA-Z0-9]/g, "");
  const N = 36;
  const recent = data.slice(-N);
  const max = Math.max(...recent, 0.0001);
  const W = 120;
  const H = 48;
  const slot = W / N;
  // Full-width rainbow "spectrum" that fills the card even at $0: every slot has a
  // gentle resting bar; a fee pushes its slot taller + brighter (newest at right).
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ff5a5a" />
          <stop offset="28%" stopColor="#ffe14d" />
          <stop offset="52%" stopColor="#5cff8f" />
          <stop offset="76%" stopColor="#3bd9ff" />
          <stop offset="100%" stopColor="#c06aff" />
        </linearGradient>
      </defs>
      {Array.from({ length: N }).map((_, i) => {
        const di = i - (N - recent.length);
        const rest = 0.45 + 0.18 * Math.sin(i * 0.5) + 0.1 * Math.sin(i * 1.27 + 1);
        const dataFrac = di >= 0 ? Math.sqrt(recent[di]) / Math.sqrt(max) : 0;
        const lit = dataFrac > rest;
        const h = Math.max(2, Math.min(1, Math.max(rest, dataFrac)) * (H - 3));
        // round to 2dp so server and client emit identical strings (Math.sin can
        // differ by 1 ULP across runtimes, which would trip a hydration mismatch)
        const f = (n: number) => n.toFixed(2);
        return (
          <rect
            key={i}
            x={f(i * slot + slot * 0.16)}
            y={f(H - h)}
            width={f(slot * 0.68)}
            height={f(h)}
            rx={0.6}
            fill={`url(#${id})`}
            opacity={lit ? 0.95 : 0.32}
          />
        );
      })}
    </svg>
  );
}

function FeesTally({
  usd,
  eth,
  count,
  history,
  burstSeq,
  accent,
  lastFeeTs,
  className = "",
}: {
  usd: number;
  eth: number;
  count: number;
  history: number[];
  burstSeq: number;
  accent: string;
  /** newest fee on the wire (any age) — proves the feed is alive while the session tally is still 0 */
  lastFeeTs?: number | null;
  className?: string;
}) {
  // protocol fees land minutes apart, so a fresh session honestly reads $0.00 —
  // without a "last fee landed Xm ago" line that looks broken, not quiet
  // (the designer read it as a dead card, 2026-08-03). Tick the age while waiting.
  const [, setAgeTick] = useState(0);
  useEffect(() => {
    if (count > 0 || !lastFeeTs) return;
    const t = setInterval(() => setAgeTick((v) => v + 1), 30_000);
    return () => clearInterval(t);
  }, [count, lastFeeTs]);
  const ageMs = lastFeeTs ? Math.max(0, Date.now() - lastFeeTs) : 0;
  const ageLabel =
    ageMs < 90_000
      ? "moments ago"
      : ageMs < 3_600_000
        ? `${Math.round(ageMs / 60_000)}m ago`
        : `${Math.floor(ageMs / 3_600_000)}h ${Math.round((ageMs % 3_600_000) / 60_000)}m ago`;
  return (
    <div
      className={`glass-card p-5 relative overflow-hidden flex flex-col transition-all duration-200 hover:-translate-y-0.5 ${className}`}
      style={{ borderColor: `${accent}40` }}
    >
      <div className="absolute -right-10 -top-12 w-32 h-32 rounded-full blur-3xl opacity-20 pointer-events-none transition-colors duration-700" style={{ background: accent }} />
      <div className="relative z-10 flex flex-1 flex-col">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-slate-300 font-semibold">
          <span className="pulse-live-dot" style={{ width: 7, height: 7 }} />
          Protocol revenue, live while you listen
        </div>
        <div className="font-mono text-5xl md:text-6xl font-bold mt-3 leading-none">
          <span key={burstSeq} className={`inline-block spectrum-text-gradient${burstSeq ? " fee-pop" : ""}`}>
            ${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
        <div className="flex items-center gap-2.5 mt-2 text-[12px] font-mono">
          <span className="text-slate-200">Ξ{eth.toFixed(4)}</span>
          <span className="text-slate-600">·</span>
          <span className="text-slate-400">
            {count > 0
              ? `${count} ${count === 1 ? "revenue event" : "revenue events"}`
              : lastFeeTs
                ? `listening · last fee ${ageLabel}`
                : "listening for the first fee…"}
          </span>
        </div>
        <div className="mt-4 flex-1 min-h-[5.5rem]">
          <ActivitySpark data={history} />
        </div>
      </div>
    </div>
  );
}

// Album art: the cover baked into the mp3 when present, otherwise a procedural
// rainbow cover seeded from the track title so every track still has imagery.
function AlbumArt({ art, title, accent, playing }: { art?: string; title: string; accent: string; playing: boolean }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [art]);

  if (art && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={art} alt={title} onError={() => setBroken(true)} className="h-full w-full object-cover" />;
  }

  const hue = hashCode(title || "prism") % 360;
  return (
    <div
      className="relative grid h-full w-full place-items-center"
      style={{
        background: `radial-gradient(circle at 30% 20%, hsl(${hue} 85% 22% / 0.9), transparent 60%),
                     radial-gradient(circle at 80% 85%, ${accent}55, transparent 55%),
                     linear-gradient(150deg, #0a0a12, #05060b)`,
      }}
    >
      <PixelRainbow className="h-1/3 w-auto" animate={false} glow={playing} />
      <div className="absolute inset-x-3 bottom-3 truncate text-center text-[12px] font-semibold text-white/70">{title}</div>
    </div>
  );
}

export default function RadioPage() {
  const radio = useRadio();
  const st = radio.station;

  // Sample the playing track's live FFT energy (bass-weighted) so the pixel
  // background pulses with the music. getLevels returns null when nothing's playing.
  const getAudioLevel = useCallback(() => {
    const lv = radio.getLevels(24);
    if (!lv) return 0;
    let sum = 0;
    let wsum = 0;
    for (let i = 0; i < lv.length; i++) {
      const w = 1 - (i / lv.length) * 0.6; // weight the low end (the beat) a touch more
      sum += lv[i] * w;
      wsum += w;
    }
    return Math.min(1, (sum / wsum) * 2.4);
  }, [radio.getLevels]);
  const accent = st.accent;
  const status = radio.playing ? "On air" : radio.loading ? "Tuning in…" : "Paused";
  const art = radio.currentTrack?.art;

  // Protocol revenue landing live while you're on the page. Each new event bumps the counter and
  // fires a one-shot "party" burst on the reactive pixel halo.
  const { events, stats } = useActivityFeed();
  const ethUsd = stats?.ethUsd ?? 0;
  const seenRef = useRef<Set<string>>(new Set());
  const primedRef = useRef(false);
  const [liveFeesUsd, setLiveFeesUsd] = useState(0);
  const [liveFeesEth, setLiveFeesEth] = useState(0);
  const [feeCount, setFeeCount] = useState(0);
  const [burstSeq, setBurstSeq] = useState(0);
  const [feeHistory, setFeeHistory] = useState<number[]>([]);

  useEffect(() => {
    const fees = events.filter((e) => e.kind === "fee");
    if (!primedRef.current) {
      if (!events.length) return; // wait for the first real batch so the backlog isn't counted
      for (const e of fees) seenRef.current.add(e.id);
      // seed the spark with the backlog's rhythm (oldest → newest) so a fresh
      // page shows the protocol's pulse instead of an empty graph — the tally
      // itself still starts at 0 and only counts fees that land while you listen
      if (ethUsd) {
        const seed = fees
          .slice(0, 48)
          .reverse()
          .map((e) => e.usd ?? (e.eth != null ? e.eth * ethUsd : 0))
          .filter((u) => u > 0);
        if (seed.length) setFeeHistory(seed);
      }
      primedRef.current = true;
      return;
    }
    const fresh = fees.filter((e) => !seenRef.current.has(e.id));
    if (!fresh.length) return;
    for (const e of fresh) seenRef.current.add(e.id);
    let addUsd = 0;
    let addEth = 0;
    const pts: number[] = [];
    for (const e of fresh) {
      const u = e.usd ?? (e.eth != null && ethUsd ? e.eth * ethUsd : 0);
      const x = e.eth ?? (e.usd != null && ethUsd ? e.usd / ethUsd : 0);
      addUsd += u;
      addEth += x;
      if (u > 0) pts.push(u);
    }
    if (addUsd > 0) {
      setLiveFeesUsd((v) => v + addUsd);
      setLiveFeesEth((v) => v + addEth);
      setFeeCount((c) => c + fresh.length);
      setBurstSeq((v) => v + 1);
      setFeeHistory((h) => [...h, ...pts].slice(-48));
    }
  }, [events, ethUsd]);

  return (
    <MothershipShell>
      {/* the audio-reactive field is the page's instrument, not chrome — it
          stays under the Mothership frame and keeps breathing with the sound */}
      <AnimatedBg variant="circle" darkOpaque rainbow edgesOnly spread={0.75} glow={1.7} wave={1} pulse={burstSeq} getAudioLevel={getAudioLevel} zIndex={0} fadeInDelayMs={200} />
      <FeeStreaks />

      <main className="relative z-10 mx-auto max-w-[1080px] px-5 md:px-6 pt-10 md:pt-14 pb-28">
        {/* hero — sat lower again with a one-line description (the designer 2026-08-03),
            the live fees tally top-right */}
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-1 flex-col items-center text-center lg:items-start lg:text-left">
            {/* centered on mobile/tablet, both lines when it wraps (the designer 1254);
                the soundtrack line is gone — the PLAY control lives there now */}
            <h1 className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-5xl font-black tracking-tight text-white sm:text-6xl lg:justify-start lg:text-7xl">
              Prismbeat Radio
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: "#FF5E00" }} />
                <span className="relative inline-flex h-3 w-3 rounded-full" style={{ background: "#FF5E00" }} />
              </span>
            </h1>
            <div className="mt-5">
              <StartRadioButton />
            </div>

            {/* the whole ecosystem, live, two and two beneath (the designer 2026-08-03) */}
            <div className="mt-6 grid w-full max-w-[620px] grid-cols-2 gap-3 text-left">
          <div className="rounded-xl p-4" style={{ ...glass, borderTop: `2px solid ${C.green}80` }}>
            <div className="text-[9px] uppercase tracking-[0.16em] text-slate-500">Lifetime revenue</div>
            <div className="mt-1 truncate text-xl font-bold tabular-nums text-white" style={{ fontFamily: MONO, ...glow(C.green) }}>
              {stats ? fmtUsd(stats.feesEthTotal * ethUsd + stats.feesPrismTotal * (stats.prismUsd ?? 0)) : "—"}
            </div>
            <div className="mt-1 text-[9px] text-slate-500" style={{ fontFamily: MONO }}>
              to holders · all time
            </div>
          </div>
          <div className="rounded-xl p-4" style={{ ...glass, borderTop: `2px solid ${C.orange}80` }}>
            <div className="text-[9px] uppercase tracking-[0.16em] text-slate-500">PRISM burnt</div>
            <div className="mt-1 truncate text-xl font-bold tabular-nums text-white" style={{ fontFamily: MONO, ...glow(C.orange) }}>
              {stats ? fmtPrism(stats.totalBurned) : "—"}
            </div>
            <div className="mt-1 text-[9px] text-slate-500" style={{ fontFamily: MONO }}>
              of {stats ? stats.cap.toLocaleString("en-US") : "5,000"} ever
            </div>
          </div>
          <div className="rounded-xl p-4" style={{ ...glass, borderTop: `2px solid ${C.purple}80` }}>
            <div className="text-[9px] uppercase tracking-[0.16em] text-slate-500">Baskets live</div>
            <div className="mt-1 truncate text-xl font-bold tabular-nums text-white" style={{ fontFamily: MONO, ...glow(C.purple) }}>
              {stats ? stats.indexCount : "—"}
            </div>
            <div className="mt-1 text-[9px] text-slate-500" style={{ fontFamily: MONO }}>
              Ethereum · Base · Robinhood
            </div>
          </div>
          <div className="rounded-xl p-4" style={{ ...glass, borderTop: `2px solid ${C.cyan}80` }}>
            <div className="text-[9px] uppercase tracking-[0.16em] text-slate-500">Revenue / PRISM · 24h</div>
            <div className="mt-1 truncate text-xl font-bold tabular-nums text-white" style={{ fontFamily: MONO, ...glow(C.cyan) }}>
              {stats && stats.supply > 0 ? `$${((stats.feesToHolders24h / stats.supply) * ethUsd).toFixed(2)}` : "—"}
            </div>
            <div className="mt-1 text-[9px] text-slate-500" style={{ fontFamily: MONO }}>
              trailing 24h · varies, can be zero
            </div>
          </div>
            </div>
          </div>
          <FeesTally
            usd={liveFeesUsd}
            eth={liveFeesEth}
            count={feeCount}
            history={feeHistory}
            burstSeq={burstSeq}
            accent={accent}
            lastFeeTs={events.find((e) => e.kind === "fee")?.ts ?? null}
            className="w-full shrink-0 lg:mt-1 lg:w-[330px]"
          />
        </div>

        {/* player — sits higher now that the eco tiles live in the header column */}
        <div className="glass-card p-6 md:p-8 mt-8 relative overflow-hidden">
          <div
            className="absolute -right-16 -top-20 w-64 h-64 rounded-full blur-3xl opacity-25 pointer-events-none transition-colors duration-700"
            style={{ background: accent }}
          />
          <div className="relative z-10 grid items-center gap-8 md:gap-10 md:grid-cols-[minmax(0,380px)_1fr]">
            {/* reactive centerpiece: pixel-rainbow halo around the album art */}
            <div className="relative mx-auto aspect-square w-full max-w-[380px]">
              <ReactiveRainbow playing={radio.playing} getLevels={radio.getLevels} burst={burstSeq} className="absolute inset-0 h-full w-full" />
              <div
                className="absolute inset-[20%] overflow-hidden rounded-2xl border border-white/10 shadow-2xl transition-transform duration-500"
                style={{ transform: radio.playing ? "scale(1.03)" : "scale(1)", boxShadow: `0 18px 60px ${accent}40` }}
              >
                <AlbumArt art={art} title={radio.title} accent={accent} playing={radio.playing} />
              </div>
            </div>

            {/* now playing + controls */}
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] font-semibold" style={{ color: radio.playing ? accent : "#64748b" }}>
                {radio.playing && <EqBars color={accent} />}
                {status}
                {radio.audioReady && <span className="text-slate-600 normal-case tracking-normal">· reactive</span>}
              </div>
              <div className="text-3xl md:text-5xl font-bold txt-white mt-2 leading-tight truncate">{radio.title}</div>
              <div className="text-sm text-slate-400 mt-1.5 truncate">{radio.subtitle}</div>
              {radio.currentTrack?.album && <div className="text-[12px] text-slate-600 mt-0.5 truncate">{radio.currentTrack.album}</div>}

              <Visualizer playing={radio.playing} getLevels={radio.getLevels} className="w-full h-20 md:h-24 mt-6" />

              <div className="flex items-center gap-3 mt-5 flex-wrap">
                {radio.isPlaylist && (
                  <button onClick={radio.prev} aria-label="Previous track" className="grid place-items-center w-10 h-10 rounded-full border border-white/10 text-slate-300 hover:text-white hover:border-white/25 transition-colors">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path d="M6 5h2v14H6zM20 5v14l-11-7z" />
                    </svg>
                  </button>
                )}

                <button
                  onClick={radio.toggle}
                  aria-label={radio.playing ? "Pause" : "Play"}
                  className="grid place-items-center w-16 h-16 rounded-full text-white transition-transform hover:scale-105 active:scale-95"
                  style={{ background: "#a855f7", boxShadow: "0 12px 40px rgba(168,85,247,0.45)" }}
                >
                  {radio.loading ? (
                    <span className="w-6 h-6 rounded-full border-[3px] border-black/30 border-t-black/80 animate-spin" />
                  ) : radio.playing ? (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <rect x="6" y="5" width="4" height="14" rx="1.2" />
                      <rect x="14" y="5" width="4" height="14" rx="1.2" />
                    </svg>
                  ) : (
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>

                {radio.isPlaylist && (
                  <button onClick={radio.next} aria-label="Next track" className="grid place-items-center w-10 h-10 rounded-full border border-white/10 text-slate-300 hover:text-white hover:border-white/25 transition-colors">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path d="M16 5h2v14h-2zM4 5l11 7-11 7z" />
                    </svg>
                  </button>
                )}

                <div className="flex items-center gap-2 ml-1">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M11 5 6 9H2v6h4l5 4z" />
                    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                  </svg>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={radio.volume}
                    onChange={(e) => radio.setVolume(parseFloat(e.target.value))}
                    className="w-28 cursor-pointer"
                    style={{ accentColor: accent }}
                    aria-label="Volume"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* station picker — wrapped in a panel so it stays readable over the pixel background */}
        <div className="glass-card mt-12 p-4 md:p-5">
        <div className="text-[10px] uppercase tracking-[0.3em] text-slate-500 font-semibold mb-4">Stations</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {STATIONS.map((s, i) => {
            const current = i === radio.stationIndex;
            const onAir = current && radio.playing;
            const sub = s.kind === "playlist" ? (radio.tracks.length ? `${radio.tracks.length} tracks` : "add tracks to /public/radio") : s.genre;
            return (
              <button
                key={s.id}
                onClick={() => radio.setStation(i)}
                className="glass-card p-4 text-left flex items-center gap-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20"
                style={current ? { borderColor: `${s.accent}66`, boxShadow: `0 0 0 1px ${s.accent}40` } : undefined}
              >
                <span className="grid place-items-center w-9 h-9 rounded-full shrink-0" style={{ background: `${s.accent}1f`, border: `1px solid ${s.accent}55` }}>
                  {onAir ? (
                    <EqBars color={s.accent} />
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill={s.accent} aria-hidden>
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold txt-white truncate">{s.name}</span>
                  <span className="block text-[12px] text-slate-500 truncate">{sub}</span>
                </span>
                {current && (
                  <span className="ml-auto text-[9px] uppercase tracking-[0.14em] font-bold shrink-0" style={{ color: s.accent }}>
                    {radio.playing ? "On air" : radio.loading ? "…" : "Cued"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        </div>

        {/* playlist tracklist */}
        {radio.isPlaylist && (
          <>
            <div className="text-[10px] uppercase tracking-[0.3em] text-slate-500 font-semibold mt-12 mb-4">
              {st.name} · {radio.tracks.length} tracks
            </div>
            {radio.tracks.length === 0 ? (
              <div className="glass-card p-6 text-center">
                <div className="text-sm text-slate-300 font-medium">No tracks yet</div>
                <div className="text-[13px] text-slate-500 mt-1.5 font-mono">
                  Drop audio files into <span className="text-slate-300">public/radio/</span> and they appear here.
                </div>
              </div>
            ) : (
              <div className="glass-card p-2 divide-y divide-white/[0.06]">
                {radio.tracks.map((t, i) => {
                  const here = i === radio.trackIndex;
                  return (
                    <button
                      key={t.src}
                      onClick={() => radio.playTrackAt(i)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left rounded-lg hover:bg-white/[0.04] transition-colors"
                    >
                      <span className="w-7 grid place-items-center shrink-0">
                        {here && radio.playing ? (
                          <EqBars color={accent} />
                        ) : t.art ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={t.art} alt="" className="h-7 w-7 rounded object-cover" />
                        ) : (
                          <span className="font-mono text-[11px] text-slate-500">{String(i + 1).padStart(2, "0")}</span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium truncate" style={{ color: here ? accent : "#e2e8f0" }}>{t.title}</span>
                        {t.artist && <span className="block text-[11px] text-slate-500 truncate">{t.artist}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        <p className="text-[11px] text-slate-600 mt-10 text-center">
          Streams by{" "}
          <a href="https://somafm.com" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white transition-colors underline underline-offset-2">
            SomaFM
          </a>
          .
        </p>
      </main>
    </MothershipShell>
  );
}
