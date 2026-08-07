"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ── The Telegram playground UI ────────────────────────────────────────────────
// A faithful-feeling group chat: persona tabs send as different members, the
// bot's replies render with their real HTML, real card images, and REAL inline
// keyboards — tapping a button fires the actual callback handler and edits the
// living draft card in place, exactly like Telegram. Styling is inline
// (Telegram's own dark palette), per the repo's Tailwind-custom-class lesson.

interface Btn {
  text: string;
  data: string;
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
}

const PERSONAS = [
  { id: 9101, name: "Ayla", color: "#ee686f" },
  { id: 9102, name: "Bez", color: "#7bc862" },
  { id: 9103, name: "Cho", color: "#65aadd" },
  { id: 9104, name: "Dex", color: "#e5a04c" },
];

const CHATTER = [
  { p: 0, t: "loading up on $PEPE and $MOG today" },
  { p: 1, t: "$PEPE $MOG is the trade honestly" },
  { p: 2, t: "cant stop buying $PEPE... $MOG too" },
  { p: 0, t: "$PEPE $MOG" },
  { p: 1, t: "$MOG $PEPE lets go" },
];

const QUICK = ["/help", "/price", "/burn", "/token PEPE", "/split 60 PEPE 40 MOG", "/ourbasket STONKMEME", "/watchlist", "/league", "/portfolio"];

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

export function TelegramSim() {
  const [chatId, setChatId] = useState(() => -Math.floor(100000 + Math.random() * 900000));
  const [persona, setPersona] = useState(0);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const scroller = useRef<HTMLDivElement>(null);

  const push = useCallback((m: Omit<Msg, "id">) => {
    const id = nextId.current++;
    setMsgs((prev) => [...prev, { ...m, id }]);
    return id;
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: 1e9, behavior: "smooth" });
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
        body: JSON.stringify({ chatId, chatTitle: "Degen Lounge", ...payload }),
      });
      return r.json();
    },
    [chatId],
  );

  const absorbReply = useCallback(
    (r?: SimReply | null) => {
      if (!r) return;
      push({
        who: "bot",
        name: "Spectra · Prism Bot",
        color: "#c06aff",
        html: tgHtml(r.text),
        photo: toLocal(r.photoUrl),
        buttons: r.buttons,
        isDraftCard: r.isDraftCard,
      });
    },
    [push],
  );

  const sendAs = useCallback(
    async (pIdx: number, text: string) => {
      const p = PERSONAS[pIdx];
      push({ who: "user", name: p.name, color: p.color, html: tgHtml(text) });
      const d = await api({ kind: "message", user: { id: p.id, first_name: p.name }, text });
      absorbReply(d.reply);
      absorbReply(d.suggestion);
    },
    [api, push, absorbReply],
  );

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    try {
      await sendAs(persona, text);
    } finally {
      setBusy(false);
    }
  };

  // a button tap — the real callback handler; refreshCard edits the card in place
  const tap = async (btn: Btn) => {
    if (busy) return;
    setBusy(true);
    try {
      const p = PERSONAS[persona];
      const d = await api({ kind: "callback", user: { id: p.id, first_name: p.name }, data: btn.data });
      showToast(d.action?.toast);
      if (d.card) {
        setMsgs((prev) => {
          const idx = [...prev].reverse().findIndex((m) => m.isDraftCard);
          if (idx < 0) return prev;
          const real = prev.length - 1 - idx;
          const next = [...prev];
          next[real] = { ...next[real], html: tgHtml(d.card.caption), photo: toLocal(d.card.photoUrl), buttons: d.card.buttons };
          return next;
        });
      }
      if (d.action?.reply) absorbReply(d.action.reply);
    } finally {
      setBusy(false);
    }
  };

  const runChatter = async () => {
    if (busy) return;
    setBusy(true);
    try {
      for (const c of CHATTER) {
        await sendAs(c.p, c.t);
        await new Promise((r) => setTimeout(r, 350));
      }
    } finally {
      setBusy(false);
    }
  };

  const joinBot = async () => {
    const d = await api({ kind: "join", user: { id: 1, first_name: "sys" } });
    push({ who: "system", html: "🔻 Spectra · Prism Bot was added to the group" });
    if (d.greeting) absorbReply(d.greeting);
  };

  const launchPreview = async () => {
    const d = await api({ kind: "launch-preview", user: { id: 1, first_name: "sys" } });
    if (d.celebration) {
      push({ who: "system", html: "⛓ on-chain: a basket matching this group's draft just launched (preview)" });
      push({ who: "bot", name: "Spectra · Prism Bot", color: "#c06aff", html: tgHtml(d.celebration.text), photo: toLocal(d.celebration.photo) });
    } else {
      showToast(d.error || "no live basket to preview with");
    }
  };

  const reset = () => {
    setChatId(-Math.floor(100000 + Math.random() * 900000));
    setMsgs([]);
    nextId.current = 1;
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0e1621", color: "#f5f5f5", fontFamily: "-apple-system, 'Segoe UI', Roboto, sans-serif", display: "flex", flexDirection: "column" }}>
      {/* header */}
      <div style={{ background: "#17212b", borderBottom: "1px solid #101921", padding: "10px 16px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 5 }}>
        <div style={{ width: 40, height: 40, borderRadius: 20, background: "linear-gradient(135deg,#9D00FF,#00F0FF)", display: "grid", placeItems: "center", fontWeight: 800 }}>DL</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>Degen Lounge</div>
          <div style={{ fontSize: 12.5, color: "#6c7883" }}>4 members, 1 bot · SIMULATOR — real handlers, fake chat · id {chatId}</div>
        </div>
        <button onClick={joinBot} style={btnStyle}>➕ Add bot</button>
        <button onClick={runChatter} style={btnStyle}>💬 Run the chatter</button>
        <button onClick={launchPreview} style={btnStyle}>🎉 Simulate launch</button>
        <button onClick={reset} style={{ ...btnStyle, background: "#3a2530", borderColor: "#5c3a48" }}>♻️ Reset group</button>
      </div>

      {/* transcript */}
      <div ref={scroller} style={{ flex: 1, overflowY: "auto", padding: "18px 0 120px" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          {msgs.length === 0 && (
            <div style={{ textAlign: "center", color: "#6c7883", fontSize: 14, marginTop: 60, lineHeight: 1.8 }}>
              This is the whole Telegram flow, live against the real handlers.<br />
              <b style={{ color: "#8b98a5" }}>The story:</b> ➕ Add bot → 💬 Run the chatter (the nudge appears) → tap <b style={{ color: "#8b98a5" }}>🧺 Start the draft</b> → tap votes, watch tiles grow → 🚀 Launch → 🎉 Simulate launch.<br />
              Or drive it yourself — pick a persona below and type.
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
                  {m.who === "bot" ? "🔻" : m.name?.[0]}
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
                      {row.map((b) => (
                        <button key={b.data} onClick={() => tap(b)} disabled={busy} style={{ flex: 1, background: "rgba(43,58,74,0.92)", border: "1px solid #3a4a5c", color: "#7fbbe8", borderRadius: 8, padding: "8px 10px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                          {b.text}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            ),
          )}
        </div>
      </div>

      {/* toast (answerCallbackQuery) */}
      {toast && (
        <div style={{ position: "fixed", top: 70, left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.85)", borderRadius: 10, padding: "10px 18px", fontSize: 14, zIndex: 20 }}>{toast}</div>
      )}

      {/* composer */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#17212b", borderTop: "1px solid #101921", padding: "10px 16px 14px" }}>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
            {PERSONAS.map((p, i) => (
              <button key={p.id} onClick={() => setPersona(i)} style={{ ...chipStyle, borderColor: persona === i ? p.color : "#2b3a4a", color: persona === i ? p.color : "#8b98a5", fontWeight: persona === i ? 800 : 500 }}>
                {p.name}
              </button>
            ))}
            <span style={{ width: 1, background: "#2b3a4a", margin: "0 4px" }} />
            {QUICK.map((q) => (
              <button key={q} onClick={() => setInput(q)} style={chipStyle}>{q}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder={`Message as ${PERSONAS[persona].name}…  (try /propose $UNI because it prints)`}
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

const btnStyle: React.CSSProperties = { background: "#242f3d", border: "1px solid #2b3a4a", color: "#c9d5df", borderRadius: 9, padding: "8px 12px", fontSize: 13.5, cursor: "pointer" };
const chipStyle: React.CSSProperties = { background: "transparent", border: "1px solid #2b3a4a", color: "#8b98a5", borderRadius: 14, padding: "4px 11px", fontSize: 13, cursor: "pointer" };
