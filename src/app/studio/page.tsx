"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MothershipShell } from "@/components/mothership/shell";
import { AmbientBlooms } from "@/components/mothership/blooms";
import { fmtUsdFull } from "@/lib/feed/format";
import { LIFETIME_FLOOR_USD } from "@/hooks/useMonotonicUsd";
import {
  MarketingCard,
  FORMATS,
  THEMES,
  type CardFormat,
  type CardTemplate,
  type CardStats,
  type Holding,
  type ThemeId,
} from "@/components/studio/marketing-card";
import {
  SocialCard,
  SOCIAL_W,
  SOCIAL_H,
  type SocialVariant,
  type SocialBentoItem,
  type SocialElId,
  type SocialElPos,
  type SocialLayout,
} from "@/components/studio/social-card";
import { SpectrumStatsCard, STATS_W, STATS_H } from "@/components/studio/spectrum-stats-card";
import { BasketCard, BASKET_CARD_W, BASKET_CARD_H, type BasketCardData } from "@/components/studio/basket-card";
import { basketShareText, basketShareUrl, bundleShareText } from "@/lib/spectrum/basket-share";
import { decodeBundleLink, extractAddresses, legPercents, looksLikeBundle, CHAIN_OF_ID } from "@/lib/spectrum/bundle-link";
import { RANGES, isRangeKey, type RangeKey } from "@/lib/feed/types";
import type { SpectrumChartsPayload } from "@/lib/spectrum/spectrum-charts";

const STATS_RANGE_KEYS: RangeKey[] = ["24h", "1w", "1m", "1y"];
const STATS_DEFAULTS = {
  headline: "Spectrum",
  tagline: "The launchpad, live: every basket launched, every buy and sell, and the fees earned across three chains.",
};

const EMPTY_LAYOUTS: Record<SocialVariant, SocialLayout> = { burn: {}, launch: {}, buy: {} };
const LAYOUTS_KEY = "prismbeat.social.layouts.v1";

// Seed copy per social post type — editable in the Studio, then ported to the bot.
const SOCIAL_DEFAULTS: Record<SocialVariant, { big: string; title: string; sub: string }> = {
  burn: {
    big: "10 PRISM",
    title: "Torched. Gone for good. 🔥",
    sub: "Fees in, PRISM out. Bought off the market and burned on-chain. Supply only ever shrinks. 5,000 cap, forever.",
  },
  launch: {
    big: "$TBV3",
    title: "A fresh basket just dropped 🧺",
    sub: "One token, the whole basket. Every trade on it feeds straight into the PRISM burn. 🔥",
  },
  buy: {
    big: "$5,200",
    title: "Whale alert! Big buy just landed 🐋",
    sub: "Serious size just hit this basket, and 25% of that fee instantly buys back & burns PRISM.",
  },
};

const SOCIAL_VARIANTS: { key: SocialVariant; label: string }[] = [
  { key: "burn", label: "🔥 Burn" },
  { key: "launch", label: "🧺 Launch" },
  { key: "buy", label: "💸 Big buy" },
];

const TEMPLATE_COPY: Record<CardTemplate, { headline: string; sub: string }> = {
  basket: {
    headline: "Spectrum Basket",
    sub: "One token. The whole basket. Held on-chain. Load any basket by address below.",
  },
  title: {
    headline: "One token, a whole thesis",
    sub: "A single token holding a whole set of assets. Hold one, own the entire basket.",
  },
  tagline: {
    headline: "Baskets on three chains",
    sub: "Launch, discover and trade basket tokens on Ethereum, Base and Robinhood Chain",
  },
  burn: {
    headline: "Permanently burned.",
    sub: "Every buy-and-burn removes PRISM from the supply for good.",
  },
  fees: {
    headline: "Revenue, to holders.",
    sub: "Every swap routes revenue to PRISM holders on-chain.",
  },
  statement: {
    headline: "The token is the position.",
    sub: "PRISM holds its own Uniswap v4 LP position on-chain.",
  },
  yield: {
    headline: "Revenue, the second it lands.",
    sub: "PRISM is a token that is also its own Uniswap v4 liquidity position. A share of the revenue from the PRISM pool and Spectrum basket launches is routed to holders on-chain, and another share buys back and burns PRISM.",
  },
};

const TEMPLATES: { key: CardTemplate; label: string }[] = [
  { key: "yield", label: "Revenue" },
  { key: "basket", label: "Basket" },
  { key: "title", label: "Title" },
  { key: "tagline", label: "Tagline" },
  { key: "burn", label: "Burn" },
  { key: "fees", label: "To holders" },
  { key: "statement", label: "Statement" },
];

// Placeholder composition only — paste a real basket address into the Load-live
// field to replace this with an actual on-chain basket (the designer 2026-08-03: no
// more Base AI Index sample anywhere).
const DEFAULT_HOLDINGS: { weight: number; ticker: string; name: string; address: string }[] = [
  { weight: 44, ticker: "NVDA", name: "NVIDIA", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" },
  { weight: 35, ticker: "STONKBROKER", name: "Stonkbroker", address: "0xe934e36A439C94017B64a3FecE66AF12099aBF50" },
  { weight: 21, ticker: "PONS", name: "Pons", address: "0x39dBED3a2bd333467115dE45665cC57F813C4571" },
];

const THEME_LIST = Object.keys(THEMES) as ThemeId[];

export default function StudioPage() {
  // Opens on the basket card: it is the thing the Studio is used for most
  // (the designer, 2026-08-13).
  const [mode, setMode] = useState<"marketing" | "social" | "stats" | "basket">("basket");

  // ── Basket mode (the designer 2026-08-13): one address in, a shareable card and the
  // post to carry it out. It reads /api/spectrum/index/[address] rather than the
  // indexes LIST that the older marketing loader uses, for two reasons: the list
  // caps `top` at six holdings, and it filters out anything with aumUsd of zero,
  // so a freshly launched basket is invisible to it. The per-address route
  // carries every holding with its price.
  const [bAddr, setBAddr] = useState("");
  const [bData, setBData] = useState<BasketCardData | null>(null);
  const [bState, setBState] = useState<"idle" | "loading" | "done" | "missing" | "error">("idle");
  const [bShare, setBShare] = useState("");
  const [bCopied, setBCopied] = useState(false);
  // Every live basket, one click away. Pasting a 42-character address to make a
  // card you post three times a week is the wrong amount of work, and the list
  // is already sorted by AUM by the route.
  const [bList, setBList] = useState<{ address: string; chain: string; symbol: string; name: string }[]>([]);
  useEffect(() => {
    if (mode !== "basket" || bList.length) return;
    let alive = true;
    fetch("/api/spectrum/indexes", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("indexes unavailable"))))
      .then((d: { indexes?: { address: string; chain: string; symbol: string; name: string }[] }) => {
        if (alive) setBList(d.indexes ?? []);
      })
      .catch(() => {
        /* the picker is a shortcut, not the only way in — the address field still works */
      });
    return () => {
      alive = false;
    };
  }, [mode, bList.length]);

  // Read one basket into the card's shape. Shared by the single-basket path and
  // by each leg of a bundle.
  async function readBasket(addr: string) {
    const r = await fetch(`/api/spectrum/index/${addr}`, { cache: "no-store" });
    if (!r.ok) return null;
    const d = await r.json();
    if (!d?.symbol || !Array.isArray(d.holdings)) return null;
    return d as {
      address: string; chain: string; name: string; symbol: string; totalCount?: number;
      holdings: Record<string, unknown>[];
    };
  }

  // A BUNDLE is a cross-chain thesis: several baskets, one card. the designer's own
  // framing is that it should not read as several baskets at all, so the card
  // flattens every leg's assets into one grid, weighting each by its leg's
  // share, and the baskets underneath never appear on the face. Assets are NOT
  // merged across chains even when the ticker matches, because a ticker is not
  // an identity here.
  async function loadBundle(link: string) {
    const parsed = decodeBundleLink(link);
    // Either form is acceptable input: a bundle LINK carrying weighted legs, or
    // simply the per-chain basket addresses of a deployed cross-chain bundle,
    // which is the kind that has no link at all. Bare addresses weight equally,
    // since nothing in the paste says otherwise.
    const legs = parsed.legs.length
      ? parsed.legs
      : extractAddresses(link).map((address) => ({ chainId: 0, address, weight: 1 }));
    if (!legs.length) {
      setBState("error");
      return;
    }
    setBState("loading");
    try {
      const pcts = legPercents(legs);
      const read = await Promise.all(
        legs.map(async (leg, i) => {
          const d = await readBasket(leg.address).catch(() => null);
          // The reader reports the chain it found the basket on, so a bare
          // address needs no chain id from the caller.
          const chain = d?.chain ?? CHAIN_OF_ID[leg.chainId] ?? "ethereum";
          return d ? { d, chain, share: pcts[i] } : null;
        }),
      );
      const live = read.filter(Boolean) as { d: NonNullable<Awaited<ReturnType<typeof readBasket>>>; chain: string; share: number }[];
      if (!live.length) {
        setBState("missing");
        return;
      }
      const holdings = live.flatMap(({ d, chain, share }) =>
        d.holdings.map((h) => {
          const within = Number(h.liveWeightPct ?? 0) || Number(h.targetWeightPct ?? 0);
          const combined = (within * share) / 100;
          return {
            symbol: String(h.symbol ?? ""),
            asset: String(h.asset ?? ""),
            priceUsd: Number(h.priceUsd ?? 0),
            liveWeightPct: combined,
            targetWeightPct: combined,
            priced: Boolean(h.priced),
            chain,
          };
        }),
      );
      const chains = [...new Set(live.map((l) => l.chain))];
      // A deployed cross-chain bundle IS its shared ticker: every leg carries
      // the same symbol by construction, so when they agree that is the name,
      // and the link's own name only has to stand in when they do not.
      const symbols = [...new Set(live.map((l) => l.d.symbol).filter(Boolean))];
      // A real deployed bundle shares one ticker across its legs, so that is the
      // title. An ad-hoc grouping of different baskets has no shared name, and
      // naming the legs is more use than the word BUNDLE.
      const shared = symbols.length === 1 ? symbols[0] : null;
      const title = (parsed.name || shared || symbols.slice(0, 3).join(" + ") || "BUNDLE").toUpperCase();
      const next: BasketCardData = {
        address: legs[0].address,
        chain: chains[0],
        name: parsed.by
          ? `by ${parsed.by.slice(0, 6)}…${parsed.by.slice(-4)}`
          : shared
            ? `One thesis, ${chains.length} chain${chains.length === 1 ? "" : "s"}`
            : "A cross-chain thesis",
        symbol: title,
        totalCount: holdings.length,
        holdings,
        bundle: { chains, basketCount: live.length },
        // Only a real pasted bundle URL earns the QR. Assembled from addresses,
        // the thesis has no page yet, and pointing the code at one leg would
        // send people somewhere they cannot tell is wrong until they arrive.
        qrUrl: /^https?:\/\//i.test(link.trim()) ? link.trim() : undefined,
      };
      setBData(next);
      setBShare(bundleShareText(parsed.name || shared, chains, holdings.map((h) => h.symbol), link));
      setBState("done");
    } catch {
      setBState("error");
    }
  }

  async function loadBasketCard(raw?: string) {
    const input = (raw ?? bAddr).trim();
    if (looksLikeBundle(input)) return loadBundle(input);
    const addr = input;
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
      setBState("error");
      return;
    }
    setBState("loading");
    try {
      const r = await fetch(`/api/spectrum/index/${addr}`, { cache: "no-store" });
      if (r.status === 404) {
        setBState("missing");
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (!d?.symbol || !Array.isArray(d.holdings) || d.holdings.length === 0) {
        setBState("missing");
        return;
      }
      const next: BasketCardData = {
        address: d.address,
        chain: d.chain,
        name: d.name,
        symbol: d.symbol,
        totalCount: d.totalCount ?? d.holdings.length,
        holdings: d.holdings.map((h: Record<string, unknown>) => ({
          symbol: String(h.symbol ?? ""),
          asset: String(h.asset ?? ""),
          priceUsd: Number(h.priceUsd ?? 0),
          liveWeightPct: Number(h.liveWeightPct ?? 0),
          targetWeightPct: Number(h.targetWeightPct ?? 0),
          priced: Boolean(h.priced),
        })),
      };
      setBData(next);
      setBShare(basketShareText(next));
      setBState("done");
    } catch {
      setBState("error");
    }
  }

  async function copyShareText() {
    try {
      await navigator.clipboard.writeText(bShare);
      setBCopied(true);
      setTimeout(() => setBCopied(false), 1600);
    } catch {
      setBCopied(false);
    }
  }
  const [socialVariant, setSocialVariant] = useState<SocialVariant>("burn");
  // Spectrum stats recap card — live payload + editable copy
  const [statsRange, setStatsRange] = useState<RangeKey>("24h");
  const [statsData, setStatsData] = useState<SpectrumChartsPayload | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsHeadline, setStatsHeadline] = useState(STATS_DEFAULTS.headline);
  const [statsTagline, setStatsTagline] = useState(STATS_DEFAULTS.tagline);
  const [socialBig, setSocialBig] = useState(SOCIAL_DEFAULTS.burn.big);
  const [socialTitle, setSocialTitle] = useState(SOCIAL_DEFAULTS.burn.title);
  const [socialSub, setSocialSub] = useState(SOCIAL_DEFAULTS.burn.sub);
  // Per-variant drag/resize offsets for the social card elements (persisted
  // locally so a rearranged layout survives reloads and drives the off-screen
  // export clone too).
  const [socialLayouts, setSocialLayouts] = useState<Record<SocialVariant, SocialLayout>>(EMPTY_LAYOUTS);
  const [layoutCopied, setLayoutCopied] = useState(false);
  const [template, setTemplate] = useState<CardTemplate>("yield");
  const [format, setFormat] = useState<CardFormat>("hd");
  const [theme, setTheme] = useState<ThemeId>("ocean");
  const [headline, setHeadline] = useState(TEMPLATE_COPY.yield.headline);
  const [sub, setSub] = useState(TEMPLATE_COPY.yield.sub);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false); // mounts the heavy full-size capture card only during export
  const [previewW, setPreviewW] = useState(1100);
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const [holdingsText, setHoldingsText] = useState(
    DEFAULT_HOLDINGS.map((hd) => `${hd.weight}, ${hd.ticker}, ${hd.name}, ${hd.address}`).join("\n"),
  );

  const [burned, setBurned] = useState(142);
  const [cap, setCap] = useState(5000);
  const [fees24h, setFees24h] = useState(6.9);
  const [supply, setSupply] = useState(4858);

  // Live yield-card numbers (USD + matching ETH leg). Seeded with a sane snapshot
  // so the card looks right before the live pull lands; pullLive() overwrites them.
  const [yld, setYld] = useState({
    fees24hUsd: 9641, fees24hEth: 5.415,
    fees7dUsd: 86364, fees7dEth: 48.51,
    feesAllUsd: 86396, feesAllEth: 48.51,
    yield24hUsd: 1.93, yield24hEth: 0.00109,
    yield1yUsd: 903, yield1yEth: 0.507,
  });

  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHeadline(TEMPLATE_COPY[template].headline);
    setSub(TEMPLATE_COPY[template].sub);
  }, [template]);

  // Reset the social copy to the type's default when the variant changes.
  useEffect(() => {
    const d = SOCIAL_DEFAULTS[socialVariant];
    setSocialBig(d.big);
    setSocialTitle(d.title);
    setSocialSub(d.sub);
  }, [socialVariant]);

  // Load any saved drag layout once on mount (guarded — never blocks the editor).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAYOUTS_KEY);
      if (raw) setSocialLayouts({ ...EMPTY_LAYOUTS, ...JSON.parse(raw) });
    } catch {
      /* ignore */
    }
  }, []);
  // Persist on every change so a reload — and the export clone — see the same layout.
  useEffect(() => {
    try {
      localStorage.setItem(LAYOUTS_KEY, JSON.stringify(socialLayouts));
    } catch {
      /* ignore */
    }
  }, [socialLayouts]);

  const onSocialLayoutChange = (id: SocialElId, pos: SocialElPos) =>
    setSocialLayouts((prev) => ({ ...prev, [socialVariant]: { ...prev[socialVariant], [id]: pos } }));
  const resetSocialLayout = () => setSocialLayouts((prev) => ({ ...prev, [socialVariant]: {} }));
  const socialMoved = Object.keys(socialLayouts[socialVariant] ?? {}).length > 0;

  // The exact copy + arrangement for all three posts — copy this and paste it
  // back to lock the design into the card defaults / the bot's OG route.
  const socialLayoutCode = JSON.stringify(
    {
      copy: { variant: socialVariant, big: socialBig, title: socialTitle, sub: socialSub },
      layouts: socialLayouts,
    },
    null,
    2,
  );
  const copyLayoutCode = async () => {
    try {
      await navigator.clipboard.writeText(socialLayoutCode);
      setLayoutCopied(true);
      setTimeout(() => setLayoutCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  // Preview fills the page width: measure the wrapper and scale the card to fit.
  useEffect(() => {
    const el = previewWrapRef.current;
    if (!el) return;
    const measure = () => setPreviewW(Math.max(320, el.clientWidth - 48));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const stats: CardStats = {
    totalBurned: burned,
    cap,
    feesToHolders24h: fees24h,
    perPrism: supply > 0 ? fees24h / supply : 0,
    supply,
    ...yld,
  };

  const holdings: Holding[] = useMemo(
    () =>
      holdingsText
        .split("\n")
        .map((line): Holding | null => {
          const parts = line.split(",").map((p) => p.trim());
          if (parts.length < 2) return null;
          const weight = parseFloat((parts[0] || "").replace(/[^0-9.]/g, "")) || 0;
          const ticker = parts[1] || "";
          if (!ticker) return null;
          // optional last field: a Base contract address or a direct image URL → logo
          const last = parts[parts.length - 1] || "";
          const isAddr = /^0x[a-fA-F0-9]{40}$/.test(last);
          const isUrl = /^https?:\/\//i.test(last);
          let logo: string | undefined;
          let nameParts = parts.slice(2);
          if (parts.length >= 3 && (isAddr || isUrl)) {
            logo = isAddr ? `/api/logo?addr=${last}` : `/api/logo?url=${encodeURIComponent(last)}`;
            nameParts = parts.slice(2, -1);
          }
          const name = nameParts.join(", ").trim();
          return { weight, ticker, name, logo };
        })
        .filter((x): x is Holding => x != null),
    [holdingsText],
  );

  // Bento items for the social launch/buy cards — parsed from the same holdings
  // text, keeping the address so tokens resolve their real brand colors.
  const bentoItems: SocialBentoItem[] = useMemo(
    () =>
      holdingsText
        .split("\n")
        .map((line): SocialBentoItem | null => {
          const p = line.split(",").map((s) => s.trim());
          if (p.length < 2 || !p[1]) return null;
          const weightPct = parseFloat((p[0] || "").replace(/[^0-9.]/g, "")) || 0;
          const last = p[p.length - 1] || "";
          const address = /^0x[a-fA-F0-9]{40}$/.test(last) ? last : "";
          return { symbol: p[1], address, weightPct };
        })
        .filter((x): x is SocialBentoItem => x != null),
    [holdingsText],
  );

  // ── load a real basket by CONTRACT ADDRESS (the designer, 2026-08-03) ──────────────
  // The card must generate from live composition, not the hardcoded sample:
  // paste any discovered basket's address and its weights/name fill the form.
  const [basketAddr, setBasketAddr] = useState("");
  const [basketLoad, setBasketLoad] = useState<"idle" | "loading" | "done" | "missing" | "error">("idle");
  async function loadBasket() {
    const addr = basketAddr.trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(addr)) return;
    setBasketLoad("loading");
    try {
      const r = await fetch("/api/spectrum/indexes", { cache: "no-store" });
      const d = (await r.json()) as {
        indexes?: { address: string; chain: string; name: string; symbol: string; top?: { symbol: string; address: string; weightPct: number }[] }[];
      };
      const hit = d.indexes?.find((x) => x.address.toLowerCase() === addr);
      if (!hit || !hit.top?.length) {
        setBasketLoad("missing");
        return;
      }
      setHoldingsText(hit.top.map((t) => `${t.weightPct.toFixed(2)}, ${t.symbol}, ${t.symbol}, ${t.address}`).join("\n"));
      if (mode === "marketing") {
        setHeadline(hit.name);
        if (template === "tagline" || template === "title") setSub(`$${hit.symbol} · one token, the whole basket`);
      } else {
        setSocialBig(`$${hit.symbol}`);
      }
      setBasketLoad("done");
    } catch {
      setBasketLoad("error");
    }
  }
  const basketLoader = (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <input
          value={basketAddr}
          onChange={(e) => {
            setBasketAddr(e.target.value);
            setBasketLoad("idle");
          }}
          onKeyDown={(e) => e.key === "Enter" && loadBasket()}
          placeholder="0x… basket contract address"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-[12px] text-white font-mono outline-none focus:border-white/30"
        />
        <button
          onClick={loadBasket}
          disabled={basketLoad === "loading" || !/^0x[a-fA-F0-9]{40}$/.test(basketAddr.trim())}
          className="shrink-0 rounded-lg border border-white/10 px-3 py-2 text-[12px] font-semibold text-slate-300 hover:text-white hover:border-white/25 disabled:opacity-40"
        >
          {basketLoad === "loading" ? "Loading…" : "Load live"}
        </button>
      </div>
      {basketLoad === "done" && <p className="text-[11px]" style={{ color: "#5cff8f" }}>Loaded from the chain · weights below are the live composition.</p>}
      {basketLoad === "missing" && <p className="text-[11px] text-amber-300">No discovered basket at that address (three chains scanned).</p>}
      {basketLoad === "error" && <p className="text-[11px] text-red-300">Could not read the basket list. Try again.</p>}
    </div>
  );

  async function pullLive() {
    try {
      const r = await fetch("/api/feed", { cache: "no-store" });
      const j = await r.json();
      const s = j.stats;
      if (!s) return;
      setBurned(Number((s.totalBurned ?? 0).toFixed(2)));
      setCap(s.cap ?? 5000);
      setFees24h(Number((s.feesToHolders24h ?? 0).toFixed(3)));
      setSupply(Number((s.supply ?? 0).toFixed(0)));

      // Yield card — mirror the side panel's math exactly.
      const ethUsd = s.ethUsd ?? 0;
      const sup = s.supply || 1;
      const perPrism = (s.feesToHolders24h ?? 0) / sup; // 24h yield per PRISM (ETH)
      const projYear = ((s.feesToHolders7d ?? 0) / sup) * (365 / 7); // annualized from the 7d run-rate
      setYld({
        fees24hUsd: (s.feesToHolders24h ?? 0) * ethUsd,
        fees24hEth: s.feesToHolders24h ?? 0,
        fees7dUsd: (s.feesToHolders7d ?? 0) * ethUsd,
        fees7dEth: s.feesToHolders7d ?? 0,
        feesAllUsd: Math.max(LIFETIME_FLOOR_USD, (s.feesToHoldersTotal ?? 0) * ethUsd),
        feesAllEth: s.feesToHoldersTotal ?? 0,
        yield24hUsd: perPrism * ethUsd,
        yield24hEth: perPrism,
        yield1yUsd: projYear * ethUsd,
        yield1yEth: projYear,
      });
    } catch {
      /* ignore */
    }
  }

  // Pull real numbers on load so the live-yield card shows on-chain data immediately.
  useEffect(() => {
    pullLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The Spectrum recap card reads the same payload as the /spectrum page.
  async function pullSpectrum(range: RangeKey = statsRange) {
    setStatsLoading(true);
    try {
      const r = await fetch(`/api/spectrum/charts?range=${range}`, { cache: "no-store" });
      if (r.ok) setStatsData((await r.json()) as SpectrumChartsPayload);
    } catch {
      /* keep the previous frame */
    } finally {
      setStatsLoading(false);
    }
  }
  useEffect(() => {
    if (mode === "stats") pullSpectrum(statsRange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, statsRange]);

  const [copied, setCopied] = useState(false);

  // Render the off-screen card to a 2× canvas (fonts loaded first).
  async function renderCanvas() {
    // Mount the full-size capture card on demand (it's heavy, so it's not kept in
    // the DOM while editing), then wait for it + its logos + fonts before capture.
    setExporting(true);
    const node = await new Promise<HTMLDivElement | null>((resolve) => {
      let n = 0;
      const tick = () => {
        if (cardRef.current) return resolve(cardRef.current);
        if (++n > 90) return resolve(null); // ~1.5s safety
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    if (!node) return null;
    // logos load async; wait so they're baked into the capture
    await Promise.all(
      Array.from(node.querySelectorAll("img")).map((img) =>
        img.complete && img.naturalWidth
          ? Promise.resolve()
          : new Promise<void>((res) => {
              const done = () => res();
              img.addEventListener("load", done, { once: true });
              img.addEventListener("error", done, { once: true });
              setTimeout(done, 4000);
            }),
      ),
    );
    if (typeof document !== "undefined" && document.fonts?.ready) await document.fonts.ready;
    // modern-screenshot (see charts/time-chart.tsx for the html2canvas /
    // html-to-image post-mortem — both die on Tailwind v4 CSS).
    const { domToCanvas } = await import("modern-screenshot"); // load the heavy lib only on export
    return Promise.race([
      domToCanvas(node, { scale: 2 }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("export timed out")), 15_000)),
    ]);
  }

  async function download() {
    setBusy(true);
    try {
      const canvas = await renderCanvas();
      if (!canvas) return;
      const a = document.createElement("a");
      a.download =
        mode === "social"
          ? `prismbeat-social-${socialVariant}.png`
          : mode === "stats"
            ? `prismbeat-spectrum-${statsRange}.png`
            : mode === "basket"
              ? `spectrum-basket-${(bData?.symbol || "basket").toLowerCase()}.png`
              : `prismbeat-${template}-${format}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    } catch (e) {
      console.error("export failed", e);
    } finally {
      setBusy(false);
      setExporting(false);
    }
  }

  // Copy the rendered PNG straight to the clipboard. A Promise<Blob> is handed to
  // ClipboardItem so Safari keeps the user-gesture context across the async render.
  async function copyImage() {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
      download(); // browser can't copy images to the clipboard — fall back to a download
      return;
    }
    setBusy(true);
    try {
      const blobPromise = (async () => {
        const canvas = await renderCanvas();
        if (!canvas) throw new Error("no canvas");
        const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
        if (!blob) throw new Error("no blob");
        return blob;
      })();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blobPromise })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) {
      console.error("copy failed — downloading instead", e);
      try {
        await download(); // any failure (permission, unsupported) → still hand over the file
      } catch {
        /* ignore */
      }
    } finally {
      setBusy(false);
      setExporting(false);
    }
  }

  const { w: mW, h: mH } = FORMATS[format];
  // Social posts + the stats recap are always the 1200×630 OG size; marketing
  // uses the chosen format.
  const w = mode === "social" ? SOCIAL_W : mode === "stats" ? STATS_W : mode === "basket" ? BASKET_CARD_W : mW;
  const h = mode === "social" ? SOCIAL_H : mode === "stats" ? STATS_H : mode === "basket" ? BASKET_CARD_H : mH;
  const scale = Math.min(1, previewW / w); // fill width, never upscale past native

  return (
    <MothershipShell>
      <AmbientBlooms />

      <div className="container mx-auto px-4 md:px-6 max-w-[1700px] py-8 relative z-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">Studio</h1>
            <p className="text-slate-400 mt-1">
              {mode === "social"
                ? "Design the auto-share post cards (1200×630) · this is what the bot posts to X & Telegram."
                : mode === "stats"
                  ? "The live Spectrum recap (1200×630): the launchpad's real on-chain numbers, ready to share."
                  : mode === "basket"
                    ? "Paste a basket address. Out comes a 1920×1080 card of its assets and the post to put it in."
                    : "Compose a branded marketing image, then copy it or export a PNG."}
            </p>
            <div className="mt-3 inline-flex rounded-full border border-white/10 bg-white/[0.03] p-1">
              {(
                [
                  { key: "basket", label: "🧺 Basket card" },
                  { key: "marketing", label: "Marketing" },
                  { key: "social", label: "Social posts" },
                  { key: "stats", label: "📊 Spectrum stats" },
                ] as const
              ).map((m) => (
                <button
                  key={m.key}
                  onClick={() => setMode(m.key)}
                  className={`text-[13px] font-semibold rounded-full px-4 py-1.5 transition-colors ${
                    mode === m.key ? "bg-white/15 text-white" : "text-slate-400 hover:text-white"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          {/* the export strip, in the Mothership language (the designer's session-end
              ask): one glass control group — mono size readout, Copy as the
              glass secondary, Download as the site's primary gradient */}
          <div
            className="flex items-center gap-2 rounded-2xl border border-white/10 p-2"
            style={{ background: "rgba(3,4,9,0.6)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}
          >
            <span
              className="hidden px-3 text-[10px] uppercase tracking-[0.16em] text-slate-500 sm:block"
              style={{ fontFamily: '"JetBrains Mono", "SF Mono", ui-monospace, monospace' }}
            >
              Exports at 2× · {w * 2}×{h * 2}
            </span>
            <button
              onClick={copyImage}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-slate-300 transition-colors hover:border-white/25 hover:text-white disabled:opacity-50"
              style={{ background: "rgba(255,255,255,0.04)" }}
            >
              {copied ? (
                <>
                  Copied
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#00FF87" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </>
              ) : (
                <>
                  Copy image
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                </>
              )}
            </button>
            <button
              onClick={download}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white transition-all duration-300 hover:brightness-110 disabled:opacity-50"
              style={{ background: "linear-gradient(90deg, #9D00FF, #00F0FF)", boxShadow: "0 0 20px #9D00FF4d" }}
            >
              {busy ? "Rendering…" : "Download PNG"}
              {!busy && (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v12" />
                  <path d="m7 10 5 5 5-5" />
                  <path d="M5 21h14" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Basket mode puts its address bar ABOVE the image and its post box
            BESIDE it (the designer, 2026-08-13) — you paste, you look, you copy, in
            reading order. Every other mode keeps the full-width preview with
            its controls underneath. */}
        {mode === "basket" && (
          <div className="glass-card p-4 mb-6 flex flex-wrap items-center gap-3">
            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold shrink-0">Basket address</div>
            <input
              value={bAddr}
              onChange={(e) => setBAddr(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") loadBasketCard();
              }}
              placeholder="0x…"
              spellCheck={false}
              className="min-w-[320px] flex-1 rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm text-white font-mono outline-none focus:border-white/30"
            />
            <button
              onClick={() => loadBasketCard()}
              disabled={bState === "loading"}
              className="rounded-lg bg-white/10 px-4 py-2 text-[13px] font-semibold text-white hover:bg-white/20 disabled:opacity-50 shrink-0"
            >
              {bState === "loading" ? "Reading…" : "Load"}
            </button>
            <p className="w-full text-[11px] leading-relaxed text-slate-500">
              {bState === "missing"
                ? "No basket answers at that address on any of the three chains."
                : bState === "error"
                  ? "That is not a valid contract address, or the read failed. Try again."
                  : bState === "done" && bData
                    ? `${bData.symbol} loaded with ${bData.totalCount} asset${bData.totalCount === 1 ? "" : "s"}. Export gives you 1920×1080.`
                    : "A basket address, or paste a whole bundle link and it becomes one cross-chain card. Prices and weights come off chain live."}
            </p>
            {bList.length > 0 && (
              <div className="w-full">
                <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-slate-500 font-semibold">
                  Or pick one · {bList.length} live
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
                  {bList.map((b) => {
                    const on = bData?.address?.toLowerCase() === b.address.toLowerCase();
                    return (
                      <button
                        key={`${b.chain}-${b.address}`}
                        onClick={() => {
                          setBAddr(b.address);
                          loadBasketCard(b.address);
                        }}
                        title={`${b.name} · ${b.chain}`}
                        className={`shrink-0 rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors ${
                          on
                            ? "border-white/40 bg-white/15 text-white"
                            : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25 hover:text-white"
                        }`}
                      >
                        {b.symbol}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <div className={mode === "basket" ? "flex flex-col gap-6 lg:flex-row lg:items-start" : ""}>
        {/* PREVIEW — full width, on top */}
        <div ref={previewWrapRef} className={`glass-card p-5 md:p-6 flex items-center justify-center overflow-hidden ${mode === "basket" ? "lg:flex-1 lg:min-w-0" : ""}`}>
          <div style={{ width: w * scale, height: h * scale }}>
            <div style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}>
              {mode === "social" ? (
                <SocialCard
                  variant={socialVariant}
                  bigText={socialBig}
                  title={socialTitle}
                  sub={socialSub}
                  holdings={bentoItems}
                  layout={socialLayouts[socialVariant]}
                  onLayoutChange={onSocialLayoutChange}
                  interactive
                  scale={scale}
                />
              ) : mode === "stats" ? (
                <SpectrumStatsCard data={statsData} headline={statsHeadline} tagline={statsTagline} />
              ) : mode === "basket" ? (
                <BasketCard data={bData} />
              ) : (
                <MarketingCard format={format} template={template} headline={headline} sub={sub} stats={stats} holdings={holdings} theme={theme} animate />
              )}
            </div>
          </div>
        </div>

        {mode === "basket" && (
          <div className="glass-card p-4 space-y-3 lg:w-[360px] lg:shrink-0">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold">The post</div>
              <button
                onClick={copyShareText}
                disabled={!bShare}
                className="text-[11px] font-semibold text-cyan-300 hover:text-cyan-200 disabled:opacity-40"
              >
                {bCopied ? "Copied ✓" : "Copy text"}
              </button>
            </div>
            <textarea
              value={bShare}
              onChange={(e) => setBShare(e.target.value)}
              rows={10}
              placeholder="Load a basket and the post writes itself. Edit it however you like before posting."
              className="w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-[13px] text-white outline-none focus:border-white/30 resize-none"
            />
            {bState === "done" && bData && (
              <a
                href={basketShareUrl(bData.symbol, bData.address, bData.chain)}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate text-[11px] font-mono text-cyan-300 hover:text-cyan-200"
              >
                {basketShareUrl(bData.symbol, bData.address, bData.chain)}
              </a>
            )}
            <p className="text-[11px] leading-relaxed text-slate-500">
              Says what the basket holds, never how it has performed. No price, no return, no burn percentage, so
              nothing here can age into a claim we have to walk back.
            </p>
          </div>
        )}
        </div>

        {/* CONTROLS — below the image, spanning the page width */}
        <div className={`grid gap-5 mt-6 md:grid-cols-2 lg:grid-cols-3 items-start ${mode === "basket" ? "hidden" : ""}`}>
          {mode === "stats" ? (
            <>
              {/* Window + refresh */}
              <div className="glass-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold">Time window</div>
                  <button onClick={() => pullSpectrum()} className="text-[11px] font-semibold text-cyan-300 hover:text-cyan-200">
                    {statsLoading ? "Pulling…" : "Pull live ↻"}
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {STATS_RANGE_KEYS.map((r) => (
                    <button
                      key={r}
                      onClick={() => isRangeKey(r) && setStatsRange(r)}
                      className={`text-sm font-semibold rounded-lg px-2 py-2 border transition-colors ${
                        statsRange === r ? "bg-white/15 border-white/25 text-white" : "bg-white/[0.03] border-white/10 text-slate-400 hover:text-white"
                      }`}
                    >
                      {RANGES[r].label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-600">
                  Every figure is pulled live from the same on-chain payload the /spectrum page renders: launches, trades,
                  volume, fees by chain, top baskets, and the 4-way fee split. Refresh right before you export.
                </p>
              </div>

              {/* Copy */}
              <div className="glass-card p-4 space-y-3">
                <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold">Copy</div>
                <div>
                  <label className="text-[11px] text-slate-500">Headline</label>
                  <input
                    value={statsHeadline}
                    onChange={(e) => setStatsHeadline(e.target.value)}
                    className="w-full mt-1 rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/30"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-500">Tagline</label>
                  <textarea
                    value={statsTagline}
                    onChange={(e) => setStatsTagline(e.target.value)}
                    rows={3}
                    className="w-full mt-1 rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/30 resize-none"
                  />
                </div>
                <button
                  onClick={() => {
                    setStatsHeadline(STATS_DEFAULTS.headline);
                    setStatsTagline(STATS_DEFAULTS.tagline);
                  }}
                  className="text-[11px] font-semibold text-cyan-300 hover:text-cyan-200"
                >
                  Reset copy ↺
                </button>
              </div>

              {/* What's on the card */}
              <div className="glass-card p-4 space-y-2">
                <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold">On the card</div>
                <ul className="text-[12px] text-slate-500 leading-relaxed list-disc pl-4 space-y-1">
                  <li>The four headline stats: baskets launched, trades, volume, fees earned</li>
                  <li>Hourly fees chart, stacked by chain (Ethereum · Base · Robinhood)</li>
                  <li>Top 3 baskets by volume, colored by their chain</li>
                  <li>The on-chain 4-way fee split</li>
                </ul>
                <p className="text-[11px] text-slate-600 pt-1">
                  Market facts only, straight from chain, safe to post as-is. Copy image drops it on your clipboard for X or Telegram.
                </p>
              </div>
            </>
          ) : mode === "social" ? (
            <>
              {/* Post type */}
              <div className="glass-card p-4 space-y-3">
                <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold">Post type</div>
                <div className="grid grid-cols-3 gap-2">
                  {SOCIAL_VARIANTS.map((v) => (
                    <button
                      key={v.key}
                      onClick={() => setSocialVariant(v.key)}
                      className={`text-sm font-semibold rounded-lg px-2 py-2 border transition-colors ${
                        socialVariant === v.key ? "bg-white/15 border-white/25 text-white" : "bg-white/[0.03] border-white/10 text-slate-400 hover:text-white"
                      }`}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-600">
                  The bot posts this card + a caption. Burn is a stat card; launch &amp; big-buy show the basket bento on the right.
                  Switching type resets the copy to its default.
                </p>
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/5">
                  <span className="text-[11px] text-slate-500">
                    ✋ Drag any element in the preview to rearrange this post.
                  </span>
                  <button
                    onClick={resetSocialLayout}
                    disabled={!socialMoved}
                    className="text-[11px] font-semibold text-cyan-300 hover:text-cyan-200 disabled:text-slate-600 disabled:cursor-default shrink-0"
                  >
                    Reset layout ↺
                  </button>
                </div>
              </div>

              {/* Copy */}
              <div className="glass-card p-4 space-y-3">
                <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold">Copy</div>
                <div>
                  <label className="text-[11px] text-slate-500">Headline figure</label>
                  <input
                    value={socialBig}
                    onChange={(e) => setSocialBig(e.target.value)}
                    className="w-full mt-1 rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/30"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-500">Title</label>
                  <textarea
                    value={socialTitle}
                    onChange={(e) => setSocialTitle(e.target.value)}
                    rows={2}
                    className="w-full mt-1 rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/30 resize-none"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-500">Subtext</label>
                  <textarea
                    value={socialSub}
                    onChange={(e) => setSocialSub(e.target.value)}
                    rows={3}
                    className="w-full mt-1 rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/30 resize-none"
                  />
                </div>
              </div>

              {/* Basket composition (launch / big-buy only) */}
              {socialVariant !== "burn" ? (
                <div className="glass-card p-4 space-y-2">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold">Basket composition</div>
                  {basketLoader}
                  <p className="text-[11px] text-slate-500">Or hand-edit, one per line: weight, ticker, name, address</p>
                  <p className="text-[11px] text-slate-600">The address gives each tile its real token color.</p>
                  <textarea
                    value={holdingsText}
                    onChange={(e) => setHoldingsText(e.target.value)}
                    rows={12}
                    spellCheck={false}
                    className="w-full mt-1 rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-[12px] text-white font-mono outline-none focus:border-white/30 resize-none leading-relaxed"
                  />
                </div>
              ) : (
                <div className="glass-card p-4 flex items-center justify-center text-[12px] text-slate-500 text-center">
                  Burn posts are a clean stat card, no basket bento.
                </div>
              )}

              {/* Layout code — the current copy + drag/resize arrangement, to paste back */}
              <div className="glass-card p-4 space-y-2 md:col-span-2 lg:col-span-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold">
                    Layout code · paste this back to lock the design
                  </div>
                  <button onClick={copyLayoutCode} className="text-[11px] font-semibold text-cyan-300 hover:text-cyan-200 shrink-0">
                    {layoutCopied ? "Copied ✓" : "Copy code"}
                  </button>
                </div>
                <p className="text-[11px] text-slate-600">
                  Reflects the live copy for <span className="text-slate-400 font-semibold">{socialVariant}</span> plus every post&apos;s
                  drag/resize offsets. Arrange all three, copy this, and paste it back to bake it into the card + the bot&apos;s OG images.
                </p>
                <textarea
                  readOnly
                  value={socialLayoutCode}
                  rows={12}
                  spellCheck={false}
                  onFocus={(e) => e.currentTarget.select()}
                  className="w-full mt-1 rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-[12px] text-slate-200 font-mono outline-none focus:border-white/30 resize-y leading-relaxed"
                />
              </div>
            </>
          ) : (
            <>
          {/* Layout: template + format + theme */}
          <div className="glass-card p-4 space-y-4">
            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold mb-2">Template</div>
              <div className="grid grid-cols-3 gap-2">
                {TEMPLATES.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setTemplate(t.key)}
                    className={`text-sm font-semibold rounded-lg px-2 py-2 border transition-colors ${
                      template === t.key ? "bg-white/15 border-white/25 text-white" : "bg-white/[0.03] border-white/10 text-slate-400 hover:text-white"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold mb-2">Format</div>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(FORMATS) as CardFormat[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFormat(f)}
                    className={`text-sm font-semibold rounded-lg px-3 py-2 border transition-colors text-left ${
                      format === f ? "bg-white/15 border-white/25 text-white" : "bg-white/[0.03] border-white/10 text-slate-400 hover:text-white"
                    }`}
                  >
                    {FORMATS[f].label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold mb-2">Color scheme</div>
              <div className="grid grid-cols-1 gap-2">
                {THEME_LIST.map((id) => {
                  const t = THEMES[id];
                  const active = theme === id;
                  return (
                    <button
                      key={id}
                      onClick={() => setTheme(id)}
                      className={`flex items-center justify-between rounded-lg px-3 py-2 border transition-colors ${
                        active ? "bg-white/15 border-white/25 text-white" : "bg-white/[0.03] border-white/10 text-slate-400 hover:text-white"
                      }`}
                    >
                      <span className="text-sm font-semibold">{t.label}</span>
                      <span className="flex -space-x-1">
                        {t.swatch.map((c, i) => (
                          <span key={i} className="h-4 w-4 rounded-full ring-1 ring-black/40" style={{ background: c }} />
                        ))}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-slate-600 mt-2">Recolors the pixel field and background of the image.</p>
            </div>
          </div>

          {/* Copy */}
          <div className="glass-card p-4 space-y-3">
            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold">Copy</div>
            <div>
              <label className="text-[11px] text-slate-500">Headline</label>
              <textarea
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                rows={2}
                className="w-full mt-1 rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/30 resize-none"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-500">Subtext</label>
              <textarea
                value={sub}
                onChange={(e) => setSub(e.target.value)}
                rows={3}
                className="w-full mt-1 rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/30 resize-none"
              />
            </div>
          </div>

          {/* Holdings (basket) or Numbers (burn/fees) */}
          {template === "basket" ? (
            <div className="glass-card p-4 space-y-2">
              <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold">Holdings</div>
              {basketLoader}
              <p className="text-[11px] text-slate-500">Or hand-edit, one per line: weight, ticker, name, address</p>
              <p className="text-[11px] text-slate-600">Address is optional (Base contract or image URL), used to fetch the logo.</p>
              <textarea
                value={holdingsText}
                onChange={(e) => setHoldingsText(e.target.value)}
                rows={12}
                spellCheck={false}
                className="w-full mt-1 rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-[12px] text-white font-mono outline-none focus:border-white/30 resize-none leading-relaxed"
              />
            </div>
          ) : template === "burn" || template === "fees" ? (
            <div className="glass-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold">Numbers</div>
                <button onClick={pullLive} className="text-[11px] font-semibold text-cyan-300 hover:text-cyan-200">
                  Pull live ↻
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {template === "burn" ? (
                  <>
                    <NumField label="PRISM burned" value={burned} onChange={setBurned} />
                    <NumField label="Cap" value={cap} onChange={setCap} />
                  </>
                ) : (
                  <>
                    <NumField label="Revenue 24h (ETH)" value={fees24h} onChange={setFees24h} step={0.1} />
                    <NumField label="Supply" value={supply} onChange={setSupply} />
                  </>
                )}
              </div>
            </div>
          ) : template === "yield" ? (
            <div className="glass-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-semibold">Live revenue stats</div>
                <button onClick={pullLive} className="text-[11px] font-semibold text-cyan-300 hover:text-cyan-200">
                  Pull live ↻
                </button>
              </div>
              <p className="text-[11px] text-slate-500">Pulled live from the chain on load. Edit the headline &amp; description on the left.</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 pt-1">
                <ReadStat label="Today" value={fmtUsdFull(yld.fees24hUsd)} />
                <ReadStat label="This week" value={fmtUsdFull(yld.fees7dUsd)} />
                <ReadStat label="All time" value={fmtUsdFull(yld.feesAllUsd)} />
                <ReadStat label="Revenue / PRISM · 24h" value={`$${yld.yield24hUsd.toFixed(2)}`} />
              </div>
            </div>
          ) : null}
            </>
          )}
        </div>
      </div>

      {/* off-screen full-size card for the high-res capture — mounted only during
          export so editing isn't weighed down by a second full card */}
      {exporting && (
        <div style={{ position: "fixed", left: -100000, top: 0, pointerEvents: "none" }} aria-hidden>
          {mode === "social" ? (
            <SocialCard ref={cardRef} variant={socialVariant} bigText={socialBig} title={socialTitle} sub={socialSub} holdings={bentoItems} layout={socialLayouts[socialVariant]} />
          ) : mode === "stats" ? (
            <SpectrumStatsCard ref={cardRef} data={statsData} headline={statsHeadline} tagline={statsTagline} />
          ) : mode === "basket" ? (
            <BasketCard ref={cardRef} data={bData} />
          ) : (
            <MarketingCard ref={cardRef} format={format} template={template} headline={headline} sub={sub} stats={stats} holdings={holdings} theme={theme} />
          )}
        </div>
      )}
    </MothershipShell>
  );
}

function ReadStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="font-mono text-sm text-white mt-0.5 tabular-nums">{value}</div>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
}) {
  return (
    <div>
      <label className="text-[11px] text-slate-500">{label}</label>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full mt-1 rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm text-white font-mono outline-none focus:border-white/30"
      />
    </div>
  );
}
