"use client";

import { useEffect, useState, type ReactNode } from "react";
import { MothershipShell } from "@/components/mothership/shell";
import { AmbientBlooms } from "@/components/mothership/blooms";
import { marketLinks, PRISM_X_URL, SPECTRUM_X_URL } from "@/lib/chain/token-links";

interface Embed {
  ok: boolean;
  url: string;
  kind: "article" | "tweet";
  title: string | null;
  text: string;
  image: string | null;
  author: { name: string; handle: string; avatar: string | null; verified: boolean };
  createdAt: string | null;
  likes: number;
}

// ── Featured writing (X posts / Articles), in narrative order. Add more here. ──
// Emptied 2026-07-29 (R) because every previous piece was about the OLD PRISM
// token, and refilled 2026-07-31 with the relaunch posts. Newest narrative first;
// the section renders itself from these URLs (titles, text, images and author all
// come from the embed fetch, so nothing here restates what a post says) and an
// empty array hides the section entirely.
const ARTICLES: string[] = [
  "https://x.com/Prism_V4hook/status/2082935237924077788",
  "https://x.com/spectrumindexes/status/2082937198194876636",
];

// X media (pbs.twimg.com) is hotlinkable and immutable, so we render the raw
// URLs directly. We deliberately do NOT route these through /api/logo: that
// proxy sets Cache-Control: immutable, and Netlify's edge collapses every
// /api/logo hit onto one cache entry — so all covers came back as whatever was
// cached first (whichever avatar won the race). The proxy is only needed for the Studio,
// where the PNG exporter requires same-origin images.

function fmtDate(iso: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M21.94 4.6 18.9 19.04c-.23 1.02-.84 1.27-1.7.79l-4.7-3.47-2.27 2.18c-.25.25-.46.46-.94.46l.33-4.78 8.7-7.86c.38-.34-.08-.53-.59-.19L6.78 13.2l-4.64-1.45c-1.01-.32-1.03-1.01.21-1.5l18.14-6.99c.84-.31 1.57.2 1.3 1.34z" />
    </svg>
  );
}
function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z" />
    </svg>
  );
}
function DropletIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12 2.5S5.5 9.4 5.5 14a6.5 6.5 0 0 0 13 0C18.5 9.4 12 2.5 12 2.5z" />
    </svg>
  );
}
function ChartIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d="M3 3v18h18" />
      <path d="m19 9-5 5-4-4-3 3" />
    </svg>
  );
}

interface Social {
  label: string;
  sub?: string;
  href: string;
  color: string;
  icon: ReactNode;
}

// Community + market links. The token-market entries are derived from the
// env-wired PRISM address (see src/lib/chain/token-links.ts) and simply don't
// render until the new token is live — the old token's Uniswap/CoinGecko pages
// and the third-party claim site were removed 2026-07-29 (ruling, relaunch).
const SOCIALS: Social[] = [
  { label: "Telegram", href: "https://t.me/PrismLP", color: "#38bdf8", icon: <TelegramIcon className="h-[18px] w-[18px]" /> },
  { label: "PRISM on X", sub: "@Prism_V4hook", href: PRISM_X_URL, color: "#e2e8f0", icon: <XIcon className="h-[18px] w-[18px]" /> },
  { label: "Spectrum on X", sub: "@spectrumindexes", href: SPECTRUM_X_URL, color: "#c084fc", icon: <XIcon className="h-[18px] w-[18px]" /> },
  ...marketLinks().map((m) => ({
    label: m.label,
    sub: "PRISM",
    href: m.href,
    color: "#fbbf24",
    icon: <ChartIcon className="h-[18px] w-[18px]" />,
  })),
];

function ArticleCard({ url }: { url: string }) {
  const [d, setD] = useState<Embed | null>(null);
  const [err, setErr] = useState(false);
  const [coverErr, setCoverErr] = useState(false);
  const [avatarErr, setAvatarErr] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(`/api/embed?url=${encodeURIComponent(url)}`)
      .then((r) => r.json())
      .then((j: Embed) => {
        if (!alive) return;
        if (j.ok) setD(j);
        else setErr(true);
      })
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [url]);

  if (err) return null;
  if (!d) return <div className="glass-card h-[360px] animate-pulse opacity-40" />;

  const cover = coverErr ? null : d.image;
  const avatar = avatarErr ? null : d.author.avatar;
  return (
    <a
      href={d.url}
      target="_blank"
      rel="noopener noreferrer"
      className="glass-card group block overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20"
    >
      {cover && (
        <div className="relative aspect-[16/9] overflow-hidden bg-white/[0.03]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cover} alt={d.title ?? "cover"} onError={() => setCoverErr(true)} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
          <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/55 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white/90 backdrop-blur-sm">
            <XIcon className="h-3 w-3" />
            {d.kind === "article" ? "Article" : "Post"}
          </span>
        </div>
      )}
      <div className="p-5">
        <h3 className="txt-white text-lg font-bold leading-snug line-clamp-2">{d.title || d.text.slice(0, 90)}</h3>
        {d.title && <p className="mt-2 text-[13px] leading-relaxed text-slate-400 line-clamp-3">{d.text}</p>}

        <div className="mt-4 flex items-center gap-2.5 border-t border-white/[0.06] pt-3.5">
          {avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt={d.author.name} onError={() => setAvatarErr(true)} className="h-8 w-8 rounded-full object-cover ring-1 ring-white/10" />
          ) : (
            <span className="h-8 w-8 rounded-full bg-slate-700" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 text-[13px] font-semibold text-white">
              <span className="truncate">{d.author.name}</span>
              {d.author.verified && (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="#3bd9ff" aria-hidden className="shrink-0">
                  <path d="M12 2 9.8 4.2 6.7 4l-.7 3.1L3 9.3l1.5 2.7L3 14.7l3 1.2.7 3.1 3.1-.2L12 21l2.2-2.2 3.1.2.7-3.1 3-1.2-1.5-2.7L21 9.3l-3-2.2L17.3 4l-3.1.2z" />
                  <path d="m9.5 12.3 1.7 1.7 3.3-3.6" fill="none" stroke="#0a0e14" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <div className="text-[11px] text-slate-500 truncate">
              @{d.author.handle}
              {d.createdAt && ` · ${fmtDate(d.createdAt)}`}
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-semibold text-slate-300 group-hover:text-white transition-colors">
            Read
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M7 17 17 7" />
              <path d="M7 7h10v10" />
            </svg>
          </span>
        </div>
      </div>
    </a>
  );
}

export default function LinksPage() {
  return (
    <MothershipShell>
      <main className="relative z-10 mx-auto max-w-[1080px] px-5 md:px-6 pt-14 pb-28">
        <AmbientBlooms />
        {/* hero — a proper title in the Mothership register */}
        <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-500">Read · Follow · Join</div>
        <h1 className="mt-2 text-4xl font-black tracking-tight text-white sm:text-5xl">Links</h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-400">
          Where to find the community
          {ARTICLES.length > 0 ? ", and the thinking behind PRISM. Read the articles, then come build with us." : ". Come build with us."}
        </p>

        {/* join the community — streamlined pills, above the writing */}
        <div className="text-[10px] uppercase tracking-[0.3em] text-slate-500 font-semibold mt-10 mb-3">Join the community</div>
        <div className="flex flex-wrap gap-3">
          {SOCIALS.map((s) => (
            <a
              key={s.href}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/5 px-5 py-2.5 text-[15px] font-semibold text-slate-200 transition-colors hover:border-white/25 hover:text-white"
            >
              <span className="shrink-0" style={{ color: s.color }}>{s.icon}</span>
              {s.label}
              {s.sub && <span className="font-normal text-slate-500">· {s.sub}</span>}
            </a>
          ))}
        </div>

        {/* writing — hidden entirely while there's nothing to feature */}
        {ARTICLES.length > 0 && (
          <>
            <div className="text-[10px] uppercase tracking-[0.3em] text-slate-500 font-semibold mt-12 mb-4">Writing</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {ARTICLES.map((u) => (
                <ArticleCard key={u} url={u} />
              ))}
            </div>
          </>
        )}
      </main>
    </MothershipShell>
  );
}
