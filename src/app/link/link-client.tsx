"use client";

import { useEffect, useState } from "react";
import { MothershipShell } from "@/components/mothership/shell";
import { useWallet } from "@/lib/wallet/context";
import { C, MONO, glass, glow } from "@/components/mothership/style";

// Connect the wallet you already use, and the Telegram account that started the
// flow can read its positions. The claim happens automatically the moment an
// account is connected — one visit, no forms.
export function LinkClient({ code }: { code: string }) {
  const { account, openPicker } = useWallet();
  const [state, setState] = useState<"idle" | "linking" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  // No code in the URL means they arrived from the site rather than the bot.
  // Connect, then hand them a deep link that opens Telegram already linked.
  const [tgUrl, setTgUrl] = useState<string | null>(null);
  useEffect(() => {
    if (code || !account || tgUrl) return;
    fetch("/api/link/mint", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: account }) })
      .then((r) => r.json())
      .then((d: { ok?: boolean; url?: string }) => {
        if (d.ok && d.url) setTgUrl(d.url);
      })
      .catch(() => {});
  }, [code, account, tgUrl]);

  useEffect(() => {
    if (!account || !code || state !== "idle") return;
    setState("linking");
    fetch("/api/link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, address: account }),
    })
      .then(async (r) => {
        const d = (await r.json()) as { ok?: boolean; error?: string };
        if (d.ok) setState("done");
        else {
          setError(d.error || "that link couldn't be completed");
          setState("error");
        }
      })
      .catch(() => {
        setError("network trouble — try the link again");
        setState("error");
      });
  }, [account, code, state]);

  const short = account ? `${account.slice(0, 6)}…${account.slice(-4)}` : null;

  return (
    <MothershipShell>
      <main className="relative z-10 mx-auto flex min-h-[70vh] max-w-[720px] flex-col justify-center px-5 py-16">
        <div className="rounded-2xl p-8" style={{ ...glass, borderTop: `2px solid ${C.cyan}80` }}>
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Telegram · wallet link</div>

          {!code ? (
            <>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-white">Your positions, in Telegram</h1>
              <p className="mt-3 text-sm leading-relaxed text-slate-400">
                Connect the wallet you already use, then open the bot. Your book is on the first screen. Read only, nothing signed.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-4">
                {tgUrl ? (
                  <a
                    href={tgUrl}
                    className="rounded-xl px-6 py-3 text-sm font-bold text-white transition-all hover:brightness-110"
                    style={{ background: `linear-gradient(90deg, ${C.purple}cc, ${C.cyan}cc)`, boxShadow: `0 0 20px ${C.cyan}40` }}
                  >
                    Open in Telegram →
                  </a>
                ) : (
                  <button
                    onClick={openPicker}
                    className="rounded-xl px-6 py-3 text-sm font-bold text-white transition-all hover:brightness-110"
                    style={{ background: `linear-gradient(90deg, ${C.purple}cc, ${C.cyan}cc)`, boxShadow: `0 0 20px ${C.cyan}40` }}
                  >
                    {account ? "Preparing…" : "Connect wallet"}
                  </button>
                )}
                {short && <span className="text-[11px] text-slate-600" style={{ fontFamily: MONO }}>{short}</span>}
              </div>
              <p className="mt-4 text-[11px] leading-relaxed text-slate-600">
                Already in the bot? Send <code className="text-slate-500">/link</code> there instead.
              </p>
            </>
          ) : state === "done" ? (
            <>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-white" style={glow(C.green)}>
                Linked ✓
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-slate-400">
                <span style={{ fontFamily: MONO }}>{short}</span> is now readable from your Telegram DM. Send{" "}
                <code className="text-slate-300">/me</code> to the bot for your positions across every chain.
              </p>
              <p className="mt-4 text-[11px] leading-relaxed text-slate-600">
                Read-only: the bot can show this address&apos;s public positions and nothing else. It never signs, never moves funds, and
                <code className="mx-1 text-slate-500">/unlink</code>ends it any time.
              </p>
            </>
          ) : state === "error" ? (
            <>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-white">That link expired</h1>
              <p className="mt-3 text-sm leading-relaxed text-slate-400">{error} — send <code className="text-slate-300">/link</code> to the bot again for a fresh one.</p>
            </>
          ) : (
            <>
              <h1 className="mt-3 text-3xl font-black tracking-tight text-white">Link your wallet to Telegram</h1>
              <p className="mt-3 text-sm leading-relaxed text-slate-400">
                Connect the wallet you already use here. Your Telegram DM can then show its positions — <b className="text-slate-300">read-only</b>, no signature, no approval, nothing granted.
              </p>
              <div className="mt-6 flex items-center gap-4">
                <button
                  onClick={openPicker}
                  className="rounded-xl px-6 py-3 text-sm font-bold text-white transition-all hover:brightness-110"
                  style={{ background: `linear-gradient(90deg, ${C.purple}cc, ${C.cyan}cc)`, boxShadow: `0 0 20px ${C.cyan}40` }}
                >
                  {state === "linking" ? "Linking…" : account ? "Linking…" : "Connect wallet"}
                </button>
                <span className="text-[11px] text-slate-600" style={{ fontFamily: MONO }}>
                  code {code}
                </span>
              </div>
            </>
          )}
        </div>
      </main>
    </MothershipShell>
  );
}
