// ── The bot ⇄ Spectrum seam map ───────────────────────────────────────────────
// The machine-readable half of docs/SPECTRUM-INTEGRATION.md: every place this
// deployment hands off to, or is called by, the Spectrum operator site. The
// playground (/dev/telegram) renders this, so "where does the bot meet
// Spectrum" is answerable by looking at the running app instead of reading
// prose. The doc explains WHY each seam is shaped this way; this file is the
// list, and it carries live status so an unwired seam says so.

/** Who serves the other end of a link the bot hands out. */
export type Side = "mothership" | "spectrum" | "telegram" | "venue" | "explorer";

export const SIDE_LABEL: Record<Side, string> = {
  mothership: "this deployment",
  spectrum: "Spectrum operator site",
  telegram: "Telegram",
  venue: "trading venue",
  explorer: "block explorer",
};

export interface Seam {
  id: string;
  title: string;
  /** which way the traffic flows */
  direction: string;
  /** one line: what actually crosses */
  what: string;
  /** the commands and taps that reach this seam */
  triggers: string[];
  /** the URL shape a user's tap opens, if any */
  opens?: string;
  /** the API shape one side calls on the other, if any */
  calls?: string;
  /** who must have built the far end */
  farSide: Side;
  /** heading in docs/SPECTRUM-INTEGRATION.md that explains it */
  doc: string;
  /** env var that wires it, when it needs wiring */
  env?: string;
}

export const SEAMS: Seam[] = [
  {
    id: "handoff",
    title: "Launch handoff",
    direction: "bot → Spectrum",
    what: "A composition the group agreed on is carried to the create page as URL params. The bot never signs or deploys; it hands over a nearly-finished basket.",
    triggers: ["/launch", "/split", "/createbasket", "🚀 Launch tap on the draft card", "/reweight (target shape)"],
    opens: "${SPECTRUM_CREATE_URL}?tokens=0xAAA…,0xBBB…&chain=ethereum|base|robinhood[&weights=60,40]",
    farSide: "spectrum",
    doc: "1. Handoff",
    env: "SPECTRUM_CREATE_URL",
  },
  {
    id: "link",
    title: "Wallet link",
    direction: "either side → bot",
    what: "A visitor with a connected wallet is handed into the bot's DM, where their positions become readable. Read-only: no approval, no spending rights, nothing signed.",
    triggers: ["/link in a DM", "/start w_<code> (arriving from a site)", "the site's Link Telegram button"],
    opens: "{mothership}/link?code=ABC123  →  https://t.me/<bot>?start=w_ABC123",
    calls: "POST {mothership}/api/link  {code,address}   ·   POST {mothership}/api/link/mint  {address}",
    farSide: "mothership",
    doc: "2. Wallet linking",
    env: "LINK_ALLOWED_ORIGINS",
  },
  {
    id: "attribution",
    title: "Launch attribution",
    direction: "chain → bot (Spectrum optional)",
    what: "How a group learns its draft went live. Today the bot matches a new basket's composition against open drafts, which is a heuristic; an echoed draft id would make it exact.",
    triggers: ["a launch event on chain", "🎉 celebration back into the group", "auto-/ourbasket registration"],
    calls: "optional: POST {mothership}/api/tg/launched  {draft}   ·   or echo &ref=tg&draft=<id> through the create page",
    farSide: "spectrum",
    doc: "3. Launch attribution",
  },
];

/** Env-derived status for one seam, so the panel can't claim a seam is live when it isn't. */
export interface SeamStatus {
  id: string;
  state: "wired" | "unwired" | "inferred";
  detail: string;
}

export function seamStatus(): SeamStatus[] {
  const create = process.env.SPECTRUM_CREATE_URL;
  const origins = process.env.LINK_ALLOWED_ORIGINS || "https://spectrumindexes.xyz";
  return [
    {
      id: "handoff",
      state: create ? "wired" : "unwired",
      detail: create
        ? `create page: ${create}`
        : "SPECTRUM_CREATE_URL is unset, so every launch tap says the operator has not wired the create page yet. The bot shows the composition anyway and invents no URL.",
    },
    {
      id: "link",
      state: "wired",
      detail: `mint + claim are live; cross-origin POSTs accepted from ${origins}`,
    },
    {
      id: "attribution",
      state: "inferred",
      detail: "composition match (overlap ≥2 and ≥ draft−1). Exact once the create page echoes a draft id.",
    },
  ];
}

/** Hosts this deployment knows by name, so a URL can be attributed to a side. */
export interface KnownHosts {
  /** this deployment's own host(s) — the configured site URL, plus wherever it is being served from */
  mothership: string[];
  /** the host of SPECTRUM_CREATE_URL, when it is wired */
  create?: string;
}

/**
 * Classify a URL the bot handed out: which side owns the page it opens. Pure —
 * hosts are passed in, so the playground can call it in the browser.
 */
export function classifyUrl(raw: string, hosts: KnownHosts): { side: Side; host: string; label: string } {
  let host = "";
  try {
    host = new URL(raw).host;
  } catch {
    return { side: "mothership", host: "", label: "malformed" };
  }
  if (host === "t.me" || host.endsWith(".t.me")) return { side: "telegram", host, label: "Telegram deep link" };
  if (hosts.mothership.includes(host)) return { side: "mothership", host, label: "this deployment" };
  if (hosts.create && host === hosts.create) return { side: "spectrum", host, label: "Spectrum create page" };
  if (/spectrumindexes\.xyz$/.test(host)) return { side: "spectrum", host, label: "Spectrum operator site" };
  if (/matcha\.xyz$|uniswap\.org$/.test(host)) return { side: "venue", host, label: "swap venue" };
  if (/etherscan\.io$|basescan\.org$|dexscreener\.com$/.test(host)) return { side: "explorer", host, label: "explorer / charts" };
  return { side: "venue", host, label: "third party" };
}
