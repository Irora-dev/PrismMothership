"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { STATIONS, DEFAULT_STATION_INDEX, type Station } from "@/lib/radio/stations";

export interface Track {
  title: string;
  artist?: string;
  album?: string;
  src: string;
  art?: string; // /api/radio/art?file=… when the mp3 embeds cover art
}

interface RadioCtx {
  station: Station;
  stationIndex: number;
  playing: boolean;
  loading: boolean;
  volume: number;
  tracks: Track[];
  trackIndex: number;
  currentTrack: Track | null;
  isPlaylist: boolean;
  title: string; // what to show as "now playing" headline
  subtitle: string;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  setStation: (i: number) => void;
  setVolume: (v: number) => void;
  next: () => void;
  prev: () => void;
  playTrackAt: (i: number) => void;
  /** Live FFT levels (0..1) downsampled to `bands`, or null when no analyser yet. */
  getLevels: (bands: number) => Float32Array | null;
  /** True once the Web Audio analyser graph is connected to the <audio> element. */
  audioReady: boolean;
}

const Ctx = createContext<RadioCtx | null>(null);

export function useRadio(): RadioCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useRadio must be used within <RadioProvider>");
  return c;
}

/**
 * Owns the single <audio> element for the whole app. Living in the root layout it
 * survives navigation, so music keeps playing across pages. Supports continuous
 * streams (SomaFM) and a local "Prism Radio" playlist auto-discovered from
 * /public/radio (auto-advances track to track).
 */
export function RadioProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [stationIndex, setStationIndex] = useState(DEFAULT_STATION_INDEX < 0 ? 0 : DEFAULT_STATION_INDEX);
  const [trackIndex, setTrackIndex] = useState(0);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [volume, setVol] = useState(0.7);

  const station = STATIONS[stationIndex] ?? STATIONS[0];
  const isPlaylist = station.kind === "playlist";
  const currentTrack = isPlaylist ? tracks[trackIndex] ?? null : null;

  // refs keep the <audio> event handlers off stale state
  const sIdxRef = useRef(stationIndex);
  sIdxRef.current = stationIndex;
  const tIdxRef = useRef(trackIndex);
  tIdxRef.current = trackIndex;
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;

  // ── Web Audio analyser — drives the reactive visuals on /radio.
  // SomaFM streams send `Access-Control-Allow-Origin: *` and local tracks are
  // same-origin, so one analyser graph handles everything without muting audio.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const srcNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const freqRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const levelsOutRef = useRef<Float32Array | null>(null);
  const [audioReady, setAudioReady] = useState(false);

  // Build the analyser graph lazily, inside a user gesture (play). createMediaElement-
  // Source is one-shot per element; after it, source→analyser→destination is permanent.
  const ensureGraph = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    try {
      if (!audioCtxRef.current) {
        const Ctor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        audioCtxRef.current = new Ctor();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      if (!srcNodeRef.current) {
        srcNodeRef.current = ctx.createMediaElementSource(a);
        const an = ctx.createAnalyser();
        an.fftSize = 1024;
        an.smoothingTimeConstant = 0.82;
        srcNodeRef.current.connect(an);
        an.connect(ctx.destination);
        analyserRef.current = an;
        setAudioReady(true);
      }
    } catch {
      /* analyser unavailable — visuals fall back to synthetic motion */
    }
  }, []);

  const getLevels = useCallback((bands: number): Float32Array | null => {
    const an = analyserRef.current;
    if (!an) return null;
    const bins = an.frequencyBinCount;
    if (!freqRef.current || freqRef.current.length !== bins) freqRef.current = new Uint8Array(bins);
    const arr = freqRef.current;
    an.getByteFrequencyData(arr);
    if (!levelsOutRef.current || levelsOutRef.current.length !== bands) levelsOutRef.current = new Float32Array(bands);
    const out = levelsOutRef.current;
    const usable = Math.max(1, Math.floor(bins * 0.72)); // top FFT bins are usually empty
    for (let i = 0; i < bands; i++) {
      const start = Math.floor((i / bands) * usable);
      const end = Math.max(start + 1, Math.floor(((i + 1) / bands) * usable));
      let s = 0;
      for (let j = start; j < end; j++) s += arr[j];
      out[i] = s / (end - start) / 255;
    }
    return out;
  }, []);

  // Per-folder track cache so switching stations (or coming back to one) is instant
  // and doesn't refetch. Empty string = the root /public/radio mix.
  const folderCacheRef = useRef<Map<string, Track[]>>(new Map());
  const loadFolder = useCallback(async (folder: string): Promise<Track[]> => {
    const hit = folderCacheRef.current.get(folder);
    if (hit) return hit;
    try {
      const q = folder ? `?folder=${encodeURIComponent(folder)}` : "";
      const r = await fetch(`/api/radio/tracks${q}`);
      const d = (await r.json()) as { tracks?: Track[] };
      const list = d.tracks ?? [];
      folderCacheRef.current.set(folder, list);
      return list;
    } catch {
      return [];
    }
  }, []);

  // Keep `tracks` in sync with the current playlist station's folder (also loads the
  // default station on mount). Streams leave the last loaded list untouched.
  const playlistFolder = station.kind === "playlist" ? station.folder ?? "" : null;
  useEffect(() => {
    if (playlistFolder == null) return;
    let alive = true;
    loadFolder(playlistFolder).then((list) => {
      if (!alive) return;
      setTracks(list);
      tracksRef.current = list;
    });
    return () => {
      alive = false;
    };
  }, [playlistFolder, loadFolder]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  // Stop and release the audio when this provider unmounts. Without this, a hot
  // reload or a remount leaves the old <audio> element playing — detached from the
  // new provider's controls — which sounds like doubled/overlapping audio that
  // won't pause. Cleanup guarantees exactly one live audio element.
  useEffect(() => {
    const a = audioRef.current;
    return () => {
      if (!a) return;
      try {
        a.pause();
        a.removeAttribute("src");
        a.load();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const srcFor = (si: number, ti: number, list: Track[]): string => {
    const st = STATIONS[si];
    return st.kind === "stream" ? st.url : list[ti]?.src ?? "";
  };

  const startSrc = useCallback((src: string) => {
    const a = audioRef.current;
    if (!a || !src) {
      setLoading(false);
      return;
    }
    ensureGraph();
    a.src = src;
    a.load();
    setLoading(true);
    a.play().catch(() => {
      setPlaying(false);
      setLoading(false);
    });
  }, [ensureGraph]);

  const play = () => {
    const a = audioRef.current;
    if (!a) return;
    ensureGraph();
    if (!a.currentSrc) {
      const want = srcFor(stationIndex, trackIndex, tracks);
      if (!want) return; // empty playlist
      a.src = want;
      a.load();
    }
    setLoading(true);
    a.play().catch(() => {
      setPlaying(false);
      setLoading(false);
    });
  };
  const pause = () => {
    audioRef.current?.pause();
    setPlaying(false);
  };
  const toggle = () => (playing ? pause() : play());

  const setStation = (i: number) => {
    setStationIndex(i);
    sIdxRef.current = i;
    setTrackIndex(0);
    tIdxRef.current = 0;
    const st = STATIONS[i];
    if (st.kind === "stream") {
      startSrc(st.url);
      return;
    }
    // playlist: load its folder (cached), then open on the lead track
    loadFolder(st.folder ?? "").then((list) => {
      setTracks(list);
      tracksRef.current = list;
      startSrc(list[0]?.src ?? "");
    });
  };

  const advance = useCallback(
    (delta: number) => {
      if (STATIONS[sIdxRef.current].kind !== "playlist") return;
      const list = tracksRef.current;
      if (!list.length) return;
      const ni = (tIdxRef.current + delta + list.length) % list.length;
      tIdxRef.current = ni;
      setTrackIndex(ni);
      startSrc(list[ni].src);
    },
    [startSrc],
  );

  const next = () => advance(1);
  const prev = () => advance(-1);

  // Plays track i of the current playlist (the tracklist UI only renders for the
  // active playlist station, so its tracks are already the current `tracks`).
  const playTrackAt = (i: number) => {
    const list = tracksRef.current;
    if (!list.length) return;
    const ni = Math.max(0, Math.min(i, list.length - 1));
    tIdxRef.current = ni;
    setTrackIndex(ni);
    startSrc(list[ni].src);
  };

  const setVolume = (v: number) => setVol(Math.min(1, Math.max(0, v)));

  const title = currentTrack?.title ?? station.name;
  const subtitle = isPlaylist
    ? currentTrack?.artist ?? (tracks.length ? `track ${trackIndex + 1} of ${tracks.length}` : "drop tracks in /public/radio")
    : station.genre;

  return (
    <Ctx.Provider
      value={{
        station,
        stationIndex,
        playing,
        loading,
        volume,
        tracks,
        trackIndex,
        currentTrack,
        isPlaylist,
        title,
        subtitle,
        toggle,
        play,
        pause,
        setStation,
        setVolume,
        next,
        prev,
        playTrackAt,
        getLevels,
        audioReady,
      }}
    >
      {children}
      <audio
        ref={audioRef}
        preload="none"
        crossOrigin="anonymous"
        onPlaying={() => {
          setPlaying(true);
          setLoading(false);
        }}
        onWaiting={() => setLoading(true)}
        onStalled={() => setLoading(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => advance(1)}
        onError={() => {
          setPlaying(false);
          setLoading(false);
        }}
      />
    </Ctx.Provider>
  );
}
