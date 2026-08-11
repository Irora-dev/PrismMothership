"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { classifyUrl, SIDE_LABEL, type Side } from "@/lib/social/seams";

// ── The Telegram playground UI ────────────────────────────────────────────────
// Two chats, both real: a GROUP (personas talk, the draft card grows with votes)
// and a PRIVATE DM (one person, their own book, every DM-gated command live).
// The mode toggle swaps the chat object the handlers receive — chat.type is what
// they read to decide whether a wallet may be shown, so a fake "group with one
// member" would prove nothing.
//
// The right rail answers the other half of the question: every link the bot
// hands out is attributed to the side that has to serve it, so where this
// deployment ends and the Spectrum operator site begins is visible rather than
// documented. Styling is inline (Telegram's own dark palette), per the repo's
// Tailwind-custom-class lesson.

type Mode = "group" | "dm";
type WhichBot = "prism" | "spectrum";

// The two bots as the playground presents them. the designer's ruling (2026-08-07):
// the Prism bot is the community's ecosystem helper, and everything basket- or
// portfolio-shaped is the Spectrum suite's own bot.
const BOT_UI: Record<WhichBot, { label: string; name: string; blurb: string; avatar: string; tint: string; quickGroup: string[]; quickDm: string[] }> = {
  prism: {
    label: "🔻 Prism bot",
    name: "Spectra · Prism Bot",
    blurb: "The community's ecosystem helper: price, burn, supply, revenue, links. It answers what it is asked and volunteers nothing.",
    avatar: "🔻",
    tint: "#c06aff",
    quickGroup: ["/help", "/price", "/burn", "/bigburn", "/supply", "/prism", "/earned", "/quote 0.5", "/wallet 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", "/ca", "/links", "/lightrunner", "/baskets"],
    quickDm: ["/start", "/help", "/price", "/burn", "/supply", "/me"],
  },
  spectrum: {
    label: "🌈 Spectrum bot",
    name: "Spectrum Bot",
    blurb: "The Spectrum suite: baskets, the group's shared basket, and your own book. This is the product.",
    avatar: "🌈",
    tint: "#f97316",
    quickGroup: ["/help", "/baskets", "/leaderboard", "/token PEPE", "/split 60 PEPE 40 MOG", "/ourbasket STONKMEME", "/watchlist", "/league", "/portfolio", "/price"],
    quickDm: ["/start", "/link", "/me", "/pnl", "/reweight 60 PEPE 40 MOG", "/buy PEPE 250", "/alerts", "/alerts 15", "/unlink", "/help", "/burn"],
  },
};

interface Btn {
  text: string;
  data?: string;
  url?: string;
}
interface Msg {
  id: number;
  who: "bot" | "user" | "system";
  name?: string;
  color?: string;
  html: string;
  photo?: string;
  buttons?: Btn[][];
  isDraftCard?: boolean;
}
interface SimReply {
  chatId: number | string;
  text: string;
  photoUrl?: string;
  buttons?: Btn[][];
  isDraftCard?: boolean;
  /** the bot asked for a reply: the next message answers this prompt */
  forceReplyPlaceholder?: string;
}
interface SeamRow {
  id: string;
  title: string;
  direction: string;
  what: string;
  triggers: string[];
  opens?: string;
  calls?: string;
  farSide: Side;
  doc: string;
  env?: string;
  status: { state: "wired" | "unwired" | "inferred"; detail: string } | null;
}
interface SeamDoc {
  seams: SeamRow[];
  hosts: { mothership: string[]; create?: string };
  features: { groupFeatures: boolean; social: boolean; batcher: boolean };
  doc: string;
}
/** one thing that crossed a boundary, in the order it happened */
interface Hop {
  id: number;
  kind: "opens" | "calls";
  trigger: string;
  url: string;
  side: Side;
  label: string;
}

const PERSONAS = [
  { id: 9101, name: "Ayla", color: "#ee686f" },
  { id: 9102, name: "Bez", color: "#7bc862" },
  { id: 9103, name: "Cho", color: "#65aadd" },
  { id: 9104, name: "Dex", color: "#e5a04c" },
];

/** the DM is one person: you */
const ME = { id: 555001, name: "You", color: "#65aadd" };

/** rendered on both sides before the real random id is seeded post-mount */
const GROUP_ID_PLACEHOLDER = -100000;
const newGroupId = () => -Math.floor(100000 + Math.random() * 900000);

const CHATTER = [
  { p: 0, t: "loading up on $PEPE and $MOG today" },
  { p: 1, t: "$PEPE $MOG is the trade honestly" },
  { p: 2, t: "cant stop buying $PEPE... $MOG too" },
  { p: 0, t: "$PEPE $MOG" },
  { p: 1, t: "$MOG $PEPE lets go" },
];


// A wallet that demonstrably holds something, so the arrival screen is a real
// book and not an empty state: WETH's own contract, which people send tokens to
// by mistake. Public address, read-only — the bot only ever reads.
const DEMO_WALLET = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
// A well-formed address with nothing in it — the empty-book path, which is the
// one that usually ships broken.
const EMPTY_WALLET = "0x38C05b4Aa8e0dF8F5D5E5A8F7e0b2c5E6a7B85B4";

// bot photo URLs come back absolute (the configured site URL) — pull them local
const toLocal = (u?: string) => {
  if (!u) return undefined;
  try {
    const url = new URL(u, window.location.origin);
    return url.pathname + url.search;
  } catch {
    return u;
  }
};

// Telegram-HTML subset → safe-enough rendering for a dev tool showing our own
// handler output: keep b/i/code/a, strip everything else.
const tgHtml = (s: string) =>
  s
    // only `<` was escaped, so the closing `>` of a tag stays literal — the
    // un-escape patterns must match `&lt;b>` not `&lt;b&gt;`
    .replace(/</g, "&lt;")
    .replace(/&lt;(\/?)(b|i|code)>/g, "<$1$2>")
    .replace(/&lt;a href="([^"]+)">/g, '<a href="$1" target="_blank" style="color:#6ab3f3">')
    .replace(/&lt;\/a>/g, "</a>")
    .replace(/\n/g, "<br/>");

/** every URL a reply hands out: the anchors in its text plus its url buttons */
const urlsIn = (r: SimReply): string[] => {
  const out: string[] = [];
  for (const m of r.text.matchAll(/<a href="([^"]+)">/g)) out.push(m[1]);
  for (const m of r.text.matchAll(/(?<!href=")\bhttps?:\/\/[^\s<]+/g)) out.push(m[0]);
  for (const row of r.buttons || []) for (const b of row) if (b.url) out.push(b.url);
  return [...new Set(out)];
};

const SIDE_COLOR: Record<Side, string> = {
  mothership: "#8b5cf6",
  spectrum: "#f97316",
  telegram: "#5288c1",
  venue: "#22c55e",
  explorer: "#64748b",
};

export function TelegramSim() {
  const [mode, setMode] = useState<Mode>("group");
  const [which, setWhich] = useState<WhichBot>("spectrum");
  // Seeded after mount, never in the initializer: a random id during render makes
  // the server's HTML and the client's disagree, which is the hydration error this
  // page carried (and the "2 Issues" badge that came with it).
  const [groupChatId, setGroupChatId] = useState(GROUP_ID_PLACEHOLDER);
  const [dmChatId, setDmChatId] = useState(() => ME.id);
  const [persona, setPersona] = useState(0);
  // one transcript per chat: toggling modes must not throw away the other story
  const [threads, setThreads] = useState<Record<Mode, Msg[]>>({ group: [], dm: [] });
  const [input, setInput] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [seams, setSeams] = useState<SeamDoc | null>(null);
  const [hops, setHops] = useState<Hop[]>([]);
  const [railOpen, setRailOpen] = useState(true);
  const [pendingReply, setPendingReply] = useState<{ prompt: string; placeholder: string } | null>(null);
  const nextId = useRef(1);
  const hopId = useRef(1);
  const scroller = useRef<HTMLDivElement>(null);

  const msgs = threads[mode];
  const chatId = mode === "dm" ? dmChatId : groupChatId;
  const who = mode === "dm" ? ME : PERSONAS[persona];

  useEffect(() => {
    setGroupChatId(newGroupId());
    fetch("/api/dev/seams")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setSeams(d))
      .catch(() => {});
    if (typeof window !== "undefined" && window.innerWidth < 1100) setRailOpen(false);
  }, []);

  const hosts = useMemo(
    () => ({
      // whatever this instance is served from counts as us too, so a localhost
      // link is not filed as a third party
      mothership: [...(seams?.hosts.mothership || []), typeof window !== "undefined" ? window.location.host : ""].filter(Boolean),
      create: seams?.hosts.create,
    }),
    [seams],
  );

  const push = useCallback(
    (m: Omit<Msg, "id">) => {
      const id = nextId.current++;
      setThreads((prev) => ({ ...prev, [mode]: [...prev[mode], { ...m, id }] }));
      return id;
    },
    [mode],
  );

  const logHop = useCallback((kind: Hop["kind"], trigger: string, url: string) => {
    setHops((prev) => {
      const c = classifyUrl(url, hosts);
      return [...prev, { id: hopId.current++, kind, trigger, url, side: c.side, label: c.label }];
    });
  }, [hosts]);

  // auto-follow only when already near the bottom — scrolling up to reread the
  // flow must never be yanked back down by a new message
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 320;
    if (nearBottom) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  const showToast = (t?: string) => {
    if (!t) return;
    setToast(t);
    setTimeout(() => setToast(null), 2600);
  };

  const api = useCallback(
    async (payload: Record<string, unknown>) => {
      const r = await fetch("/api/dev/tg-sim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chatId,
          chatType: mode === "dm" ? "private" : "supergroup",
          chatTitle: "Degen Lounge",
          bot: which,
          ...payload,
        }),
      });
      return r.json();
    },
    [chatId, mode, which],
  );

  const absorbReply = useCallback(
    (r: SimReply | null | undefined, trigger: string) => {
      if (!r) return;
      push({
        who: "bot",
        name: BOT_UI[which].name,
        color: BOT_UI[which].tint,
        html: tgHtml(r.text),
        photo: toLocal(r.photoUrl),
        buttons: r.buttons,
        isDraftCard: r.isDraftCard,
      });
      // a force-reply prompt arms the composer: Telegram delivers the prompt text
      // with its tags stripped, so the handlers match against the stripped form
      if (r.forceReplyPlaceholder) setPendingReply({ prompt: r.text.replace(/<[^>]+>/g, ""), placeholder: r.forceReplyPlaceholder });
      for (const u of urlsIn(r)) logHop("opens", trigger, u);
    },
    [push, logHop, which],
  );

  const sendText = useCallback(
    async (text: string, as?: { id: number; name: string; color: string }) => {
      const p = as || who;
      push({ who: "user", name: p.name, color: p.color, html: tgHtml(text) });
      const answering = pendingReply;
      setPendingReply(null);
      const d = await api({ kind: "message", user: { id: p.id, first_name: p.name }, text, replyToText: answering?.prompt });
      absorbReply(d.reply, text);
      absorbReply(d.suggestion, `${text} (suggestion)`);
    },
    [api, push, absorbReply, who, pendingReply],
  );

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    try {
      await sendText(text);
    } finally {
      setBusy(false);
    }
  };

  // a callback-data tap — the real handler; refreshCard edits the card in place
  const tap = async (btn: Btn) => {
    if (busy || !btn.data) return;
    setBusy(true);
    try {
      const d = await api({ kind: "callback", user: { id: who.id, first_name: who.name }, data: btn.data });
      showToast(d.action?.toast);
      if (d.card) {
        setThreads((prev) => {
          const list = prev[mode];
          const idx = [...list].reverse().findIndex((m) => m.isDraftCard);
          if (idx < 0) return prev;
          const real = list.length - 1 - idx;
          const next = [...list];
          next[real] = { ...next[real], html: tgHtml(d.card.caption), photo: toLocal(d.card.photoUrl), buttons: d.card.buttons };
          return { ...prev, [mode]: next };
        });
      }
      if (d.action?.reply) absorbReply(d.action.reply, `tap: ${btn.text}`);
    } finally {
      setBusy(false);
    }
  };

  const runChatter = async () => {
    if (busy) return;
    setBusy(true);
    try {
      for (const c of CHATTER) {
        await sendText(c.t, PERSONAS[c.p]);
        await new Promise((r) => setTimeout(r, 350));
      }
    } finally {
      setBusy(false);
    }
  };

  const joinBot = async () => {
    const d = await api({ kind: "join", user: { id: 1, first_name: "sys" } });
    push({ who: "system", html: `${BOT_UI[which].avatar} ${BOT_UI[which].name} was added to the group` });
    if (d.greeting) absorbReply(d.greeting, "bot added to the group");
  };

  const launchPreview = async () => {
    const d = await api({ kind: "launch-preview", user: { id: 1, first_name: "sys" } });
    if (d.celebration) {
      push({ who: "system", html: "⛓ on-chain: a basket matching this group's draft just launched (preview)" });
      push({ who: "bot", name: BOT_UI[which].name, color: BOT_UI[which].tint, html: tgHtml(d.celebration.text), photo: toLocal(d.celebration.photo) });
    } else {
      showToast(d.error || "no live basket to preview with");
    }
  };

  // ── the DM story ────────────────────────────────────────────────────────────
  // Arriving from a site is the one path that starts somewhere else: the site
  // mints a code for a wallet it already has connected, and hands over a deep
  // link. This calls the REAL mint endpoint — the same one spectrumindexes.xyz
  // is invited to call — then feeds the bot the deep-link payload.
  const arriveFromSite = async (address: string, whose: string) => {
    if (busy) return;
    setBusy(true);
    try {
      logHop("calls", `site: ${whose}`, `${window.location.origin}/api/link/mint`);
      const r = await fetch("/api/link/mint", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const d = await r.json();
      if (!d?.ok || !d.code) {
        showToast(d?.error || "mint failed");
        return;
      }
      push({
        who: "system",
        html: `🌐 on the site: wallet <b>${address.slice(0, 6)}…${address.slice(-4)}</b> connected → <code>POST /api/link/mint</code> → tapped <b>Open in Telegram</b>`,
      });
      logHop("opens", `site: ${whose}`, d.url);
      await sendText(`/start w_${d.code}`);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    if (mode === "dm") {
      // a fresh telegram user id = an unlinked stranger again
      setDmChatId(ME.id + Math.floor(1 + Math.random() * 9000));
    } else {
      setGroupChatId(newGroupId());
    }
    setThreads((prev) => ({ ...prev, [mode]: [] }));
    setHops([]);
  };

  const isDm = mode === "dm";

  // Switching bot is switching chat: two different bots are two different
  // conversations, so carrying a transcript across would be a lie.
  const switchBot = (b: WhichBot) => {
    if (b === which) return;
    setWhich(b);
    setThreads({ group: [], dm: [] });
    setHops([]);
    setPendingReply(null);
  };

  return (
    <div style={{ height: "100vh", overflow: "hidden", background: "#0e1621", color: "#f5f5f5", fontFamily: "-apple-system, 'Segoe UI', Roboto, sans-serif", display: "flex", flexDirection: "column" }}>
      {/* header */}
      <div style={{ background: "#17212b", borderBottom: "1px solid #101921", padding: "10px 16px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 5, flexWrap: "wrap" }}>
        <div style={{ display: "flex", background: "#0e1621", border: "1px solid #2b3a4a", borderRadius: 10, padding: 3, gap: 3 }}>
          {(["prism", "spectrum"] as WhichBot[]).map((b) => (
            <button
              key={b}
              onClick={() => switchBot(b)}
              title={BOT_UI[b].blurb}
              style={{
                background: which === b ? BOT_UI[b].tint : "transparent",
                color: which === b ? "#0e1621" : "#8b98a5",
                border: "none",
                borderRadius: 8,
                padding: "7px 13px",
                fontSize: 13.5,
                fontWeight: which === b ? 800 : 500,
                cursor: "pointer",
              }}
            >
              {BOT_UI[b].label}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", background: "#0e1621", border: "1px solid #2b3a4a", borderRadius: 10, padding: 3, gap: 3 }}>
          {(["group", "dm"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                background: mode === m ? "#5288c1" : "transparent",
                color: mode === m ? "#fff" : "#8b98a5",
                border: "none",
                borderRadius: 8,
                padding: "7px 13px",
                fontSize: 13.5,
                fontWeight: mode === m ? 700 : 500,
                cursor: "pointer",
              }}
            >
              {m === "group" ? "👥 Group" : "👤 Private DM"}
            </button>
          ))}
        </div>
        <div style={{ width: 40, height: 40, borderRadius: 20, background: "linear-gradient(135deg,#9D00FF,#00F0FF)", display: "grid", placeItems: "center", fontWeight: 800 }}>{isDm ? BOT_UI[which].avatar : "DL"}</div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontWeight: 700 }}>{isDm ? BOT_UI[which].name : "Degen Lounge"}</div>
          <div style={{ fontSize: 12.5, color: "#6c7883" }}>
            {isDm ? `bot · private chat · you are user ${dmChatId}` : `4 members, 1 bot · id ${groupChatId}`} · SIMULATOR · real handlers, fake chat
          </div>
        </div>
        {isDm ? (
          <>
            <button onClick={() => arriveFromSite(DEMO_WALLET, "wallet with a book")} disabled={busy} style={btnStyle}>🌐 Arrive from the site</button>
            <button onClick={() => arriveFromSite(EMPTY_WALLET, "empty wallet")} disabled={busy} style={btnStyle}>🫙 Arrive, empty wallet</button>
            <button onClick={() => !busy && sendText("/start")} disabled={busy} style={btnStyle}>❄️ Cold start</button>
            <button onClick={() => !busy && sendText("/link")} disabled={busy} style={btnStyle}>👛 Link a wallet</button>
          </>
        ) : (
          <>
            <button onClick={joinBot} style={btnStyle}>➕ Add bot</button>
            <button onClick={runChatter} style={btnStyle}>💬 Run the chatter</button>
            <button onClick={launchPreview} style={btnStyle}>🎉 Simulate launch</button>
          </>
        )}
        <button onClick={reset} style={{ ...btnStyle, background: "#3a2530", borderColor: "#5c3a48" }}>♻️ Reset {isDm ? "chat" : "group"}</button>
        <button onClick={() => setRailOpen((v) => !v)} style={{ ...btnStyle, borderColor: railOpen ? "#5288c1" : "#2b3a4a", color: railOpen ? "#7fbbe8" : "#c9d5df" }}>🔗 Seam map</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {/* transcript */}
        <div ref={scroller} style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "18px 0 24px" }}>
          <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            {msgs.length === 0 && (
              <div style={{ textAlign: "center", color: "#6c7883", fontSize: 14, marginTop: 60, lineHeight: 1.8 }}>
                <div style={{ maxWidth: 560, margin: "0 auto 22px", padding: "12px 16px", background: "#17212b", border: `1px solid ${BOT_UI[which].tint}44`, borderRadius: 10 }}>
                  <b style={{ color: BOT_UI[which].tint }}>{BOT_UI[which].label}</b>
                  <div style={{ marginTop: 5, fontSize: 13, lineHeight: 1.6 }}>{BOT_UI[which].blurb}</div>
                  <div style={{ marginTop: 7, fontSize: 12, color: "#5b6874" }}>
                    A command the other bot owns is answered with a pointer to it, never a shrug. Try {which === "prism" ? <code>/me</code> : <code>/burn</code>} here.
                  </div>
                </div>
                {isDm ? (
                  <>
                    This is the <b style={{ color: "#8b98a5" }}>private chat</b>, where a wallet may be shown. Every DM-gated command answers here and refuses in the group.
                    <br />
                    <b style={{ color: "#8b98a5" }}>Three ways in:</b> 🌐 Arrive from the site (a wallet is already connected, so screen one is their book) · ❄️ Cold start (a stranger opens the bot) · 👛 Link a wallet (they type <code>/link</code>).
                    <br />
                    Then <code>/me</code> <code>/pnl</code> <code>/reweight</code> <code>/buy</code> <code>/alerts</code>.
                  </>
                ) : (
                  <>
                    This is the whole Telegram flow, live against the real handlers.
                    <br />
                    <b style={{ color: "#8b98a5" }}>The story:</b> ➕ Add bot → 💬 Run the chatter (the nudge appears) → tap <b style={{ color: "#8b98a5" }}>🧺 Start the draft</b> → tap votes, watch tiles grow → 🚀 Launch → 🎉 Simulate launch.
                    <br />
                    Or drive it yourself: pick a persona below and type.
                  </>
                )}
              </div>
            )}
            {msgs.map((m) =>
              m.who === "system" ? (
                <div key={m.id} style={{ textAlign: "center" }}>
                  <span style={{ background: "#17212b", borderRadius: 12, padding: "4px 12px", fontSize: 12.5, color: "#8b98a5" }} dangerouslySetInnerHTML={{ __html: m.html }} />
                </div>
              ) : (
                <div key={m.id} style={{ display: "flex", gap: 9, alignItems: "flex-end" }}>
                  <div style={{ width: 34, height: 34, borderRadius: 17, flexShrink: 0, background: m.who === "bot" ? "linear-gradient(135deg,#9D00FF,#00F0FF)" : m.color, display: "grid", placeItems: "center", fontSize: 15, fontWeight: 800, color: "#fff" }}>
                    {m.who === "bot" ? BOT_UI[which].avatar : m.name?.[0]}
                  </div>
                  <div style={{ maxWidth: 520 }}>
                    <div style={{ background: "#17212b", borderRadius: 12, borderBottomLeftRadius: 4, overflow: "hidden" }}>
                      {m.photo && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.photo} alt="" style={{ display: "block", width: "100%", maxWidth: 520 }} />
                      )}
                      <div style={{ padding: "7px 12px 8px" }}>
                        <div style={{ fontSize: 13.5, fontWeight: 700, color: m.color, marginBottom: 2 }}>{m.name}</div>
                        <div style={{ fontSize: 15, lineHeight: 1.45, wordBreak: "break-word" }} dangerouslySetInnerHTML={{ __html: m.html }} />
                      </div>
                    </div>
                    {m.buttons?.map((row, ri) => (
                      <div key={ri} style={{ display: "flex", gap: 4, marginTop: 4 }}>
                        {row.map((b, bi) =>
                          // a url button leaves Telegram — it must render as a link,
                          // not as a callback that fires nothing
                          b.url ? (
                            <a
                              key={`${ri}-${bi}`}
                              href={b.url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={() => logHop("opens", `tap: ${b.text}`, b.url!)}
                              style={{ ...kbdStyle, textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
                              title={b.url}
                            >
                              {b.text}
                              <span style={{ fontSize: 11, color: SIDE_COLOR[classifyUrl(b.url, hosts).side], fontWeight: 700 }}>↗ {classifyUrl(b.url, hosts).host}</span>
                            </a>
                          ) : (
                            <button key={`${ri}-${bi}`} onClick={() => tap(b)} disabled={busy} style={kbdStyle}>
                              {b.text}
                            </button>
                          ),
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ),
            )}
          </div>
        </div>

        {/* the seam rail */}
        {railOpen && <SeamRail seams={seams} hops={hops} which={which} onClear={() => setHops([])} />}
      </div>

      {/* toast (answerCallbackQuery) */}
      {toast && (
        <div style={{ position: "fixed", top: 70, left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.85)", borderRadius: 10, padding: "10px 18px", fontSize: 14, zIndex: 20 }}>{toast}</div>
      )}

      {/* composer */}
      <div style={{ background: "#17212b", borderTop: "1px solid #101921", padding: "10px 16px 14px" }}>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
            {isDm ? (
              <span style={{ ...chipStyle, borderColor: ME.color, color: ME.color, fontWeight: 800, cursor: "default" }}>You</span>
            ) : (
              PERSONAS.map((p, i) => (
                <button key={p.id} onClick={() => setPersona(i)} style={{ ...chipStyle, borderColor: persona === i ? p.color : "#2b3a4a", color: persona === i ? p.color : "#8b98a5", fontWeight: persona === i ? 800 : 500 }}>
                  {p.name}
                </button>
              ))
            )}
            <span style={{ width: 1, background: "#2b3a4a", margin: "0 4px" }} />
            {(isDm ? BOT_UI[which].quickDm : BOT_UI[which].quickGroup).map((q) => (
              <button key={q} onClick={() => setInput(q)} style={chipStyle}>{q}</button>
            ))}
          </div>
          {pendingReply && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#242f3d", borderLeft: "3px solid #5288c1", borderRadius: 6, padding: "6px 10px", marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: "#7fbbe8", fontWeight: 700 }}>replying to</span>
              <span style={{ fontSize: 12, color: "#8b98a5", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pendingReply.prompt.split("\n")[0]}</span>
              <button onClick={() => setPendingReply(null)} style={{ background: "transparent", border: "none", color: "#6c7883", cursor: "pointer", fontSize: 14 }}>✕</button>
            </div>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder={pendingReply ? pendingReply.placeholder : isDm ? "Message the bot privately…  (try /me once a wallet is linked)" : `Message as ${PERSONAS[persona].name}…  (try /propose $UNI because it prints)`}
              style={{ flex: 1, background: "#242f3d", border: "1px solid #2b3a4a", borderRadius: 10, padding: "11px 14px", color: "#f5f5f5", fontSize: 15, outline: "none" }}
            />
            <button onClick={send} disabled={busy} style={{ ...btnStyle, background: "#5288c1", borderColor: "#5288c1", color: "#fff", opacity: busy ? 0.6 : 1 }}>
              {busy ? "…" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── The seam rail ─────────────────────────────────────────────────────────────
// Top half: the three places this deployment and the Spectrum operator site
// meet, each with the live wiring state — an unwired seam says so. Bottom half:
// every link the bot actually handed out in this session, attributed to the side
// that has to serve it.
function SeamRail({ seams, hops, which, onClear }: { seams: SeamDoc | null; hops: Hop[]; which: WhichBot; onClear: () => void }) {
  return (
    <div style={{ width: 380, flexShrink: 0, borderLeft: "1px solid #101921", background: "#131c26", overflowY: "auto", padding: "16px 14px 28px" }}>
      <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 3 }}>Where this meets Spectrum</div>
      <div style={{ fontSize: 12, color: "#6c7883", lineHeight: 1.55, marginBottom: 14 }}>
        {which === "prism" ? (
          <>
            <b style={{ color: "#c06aff" }}>The Prism bot has no seam with the Spectrum site.</b> It reports ecosystem numbers and links to this deployment only. Switch to the Spectrum bot to see the handoffs below in use.
          </>
        ) : (
          <>The Spectrum bot and its cards run here. Choosing weights, naming and signing a basket happen on the Spectrum operator site. Nothing is shared but URLs.</>
        )}
        {seams?.doc && <> The long form is <code style={{ color: "#8b98a5" }}>{seams.doc}</code>.</>}
      </div>

      {!seams && <div style={{ fontSize: 12.5, color: "#6c7883" }}>loading the seam map…</div>}

      {seams?.seams.map((s) => (
        <div key={s.id} style={{ background: "#17212b", border: "1px solid #22303c", borderRadius: 10, padding: "11px 12px", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
            <span style={{ fontSize: 13.5, fontWeight: 800 }}>{s.title}</span>
            <span style={{ fontSize: 10.5, color: SIDE_COLOR[s.farSide], border: `1px solid ${SIDE_COLOR[s.farSide]}55`, borderRadius: 6, padding: "1px 6px", whiteSpace: "nowrap" }}>{SIDE_LABEL[s.farSide]}</span>
          </div>
          <div style={{ fontSize: 11, color: "#6c7883", marginBottom: 6 }}>{s.direction}</div>
          <div style={{ fontSize: 12.5, color: "#c9d5df", lineHeight: 1.5, marginBottom: 7 }}>{s.what}</div>
          {s.opens && <Mono label="opens" value={s.opens} />}
          {s.calls && <Mono label="calls" value={s.calls} />}
          {s.status && (
            <div style={{ marginTop: 7, display: "flex", gap: 7, alignItems: "flex-start" }}>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 800,
                  whiteSpace: "nowrap",
                  color: s.status.state === "wired" ? "#22c55e" : s.status.state === "unwired" ? "#f97316" : "#eab308",
                  border: `1px solid ${s.status.state === "wired" ? "#22c55e" : s.status.state === "unwired" ? "#f97316" : "#eab308"}55`,
                  borderRadius: 6,
                  padding: "2px 7px",
                }}
              >
                {s.status.state}
              </span>
              <span style={{ fontSize: 11.5, color: "#8b98a5", lineHeight: 1.5 }}>{s.status.detail}</span>
            </div>
          )}
          <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
            {s.triggers.map((t) => (
              <span key={t} style={{ fontSize: 10.5, color: "#7d8b98", border: "1px solid #2b3a4a", borderRadius: 5, padding: "1px 6px" }}>{t}</span>
            ))}
          </div>
        </div>
      ))}

      {seams && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "4px 0 16px" }}>
          {[
            { k: "group features", on: seams.features.groupFeatures },
            { k: "social posts", on: seams.features.social },
            { k: "portfolio batcher", on: seams.features.batcher },
          ].map((f) => (
            <span key={f.k} style={{ fontSize: 10.5, color: f.on ? "#22c55e" : "#6c7883", border: `1px solid ${f.on ? "#22c55e55" : "#2b3a4a"}`, borderRadius: 6, padding: "2px 7px" }}>
              {f.on ? "armed" : "dark"} · {f.k}
            </span>
          ))}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid #22303c", paddingTop: 12, marginBottom: 8 }}>
        <span style={{ fontSize: 13.5, fontWeight: 800 }}>Links handed out ({hops.length})</span>
        {hops.length > 0 && (
          <button onClick={onClear} style={{ background: "transparent", border: "1px solid #2b3a4a", color: "#6c7883", borderRadius: 6, padding: "2px 7px", fontSize: 11, cursor: "pointer" }}>clear</button>
        )}
      </div>
      {hops.length === 0 && <div style={{ fontSize: 12, color: "#6c7883", lineHeight: 1.55 }}>Nothing yet. Every page the bot opens and every API it is handed to shows up here, tagged with the side that serves it.</div>}
      {[...hops].reverse().map((h) => (
        <div key={h.id} style={{ borderBottom: "1px solid #1b2632", padding: "7px 0" }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 2 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: SIDE_COLOR[h.side], border: `1px solid ${SIDE_COLOR[h.side]}55`, borderRadius: 5, padding: "1px 5px", whiteSpace: "nowrap" }}>{h.label}</span>
            <span style={{ fontSize: 10.5, color: "#6c7883" }}>{h.kind === "calls" ? "API call" : "opens"}</span>
          </div>
          <div style={{ fontSize: 11.5, color: "#8b98a5", wordBreak: "break-all", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{h.url}</div>
          <div style={{ fontSize: 10.5, color: "#5b6874", marginTop: 2 }}>from {h.trigger}</div>
        </div>
      ))}
    </div>
  );
}

const Mono = ({ label, value }: { label: string; value: string }) => (
  <div style={{ marginTop: 5 }}>
    <div style={{ fontSize: 10, color: "#5b6874", textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</div>
    <div style={{ fontSize: 11.5, color: "#7fbbe8", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", wordBreak: "break-all", lineHeight: 1.5 }}>{value}</div>
  </div>
);

const btnStyle: React.CSSProperties = { background: "#242f3d", border: "1px solid #2b3a4a", color: "#c9d5df", borderRadius: 9, padding: "8px 12px", fontSize: 13.5, cursor: "pointer" };
const chipStyle: React.CSSProperties = { background: "transparent", border: "1px solid #2b3a4a", color: "#8b98a5", borderRadius: 14, padding: "4px 11px", fontSize: 13, cursor: "pointer" };
const kbdStyle: React.CSSProperties = { flex: 1, background: "rgba(43,58,74,0.92)", border: "1px solid #3a4a5c", color: "#7fbbe8", borderRadius: 8, padding: "8px 10px", fontSize: 14, fontWeight: 600, cursor: "pointer" };
