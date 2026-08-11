"use client";

import { useEffect, useState } from "react";
import { MothershipShell } from "@/components/mothership/shell";
import { AmbientBlooms } from "@/components/mothership/blooms";
import { C, MONO, glass, glow } from "@/components/mothership/style";

// /setup — the integrator studio. The kit's three identity values (domain,
// hosting platform, RPC key) filled in the browser. In dev, Apply writes them
// into the project (site.config.json + .env.local via /api/setup/apply); on a
// deployed site the route refuses and this page becomes a copyable checklist
// for the host's env-var UI instead.

const PLATFORMS = [
  { id: "netlify", name: "Netlify", note: "netlify.toml ships in the repo. Connect the repo, add the env vars in Site settings, deploy." },
  { id: "vercel", name: "Vercel", note: "vercel.json ships in the repo. Import the repo, add the env vars in Project settings, deploy." },
  { id: "cloudflare", name: "Cloudflare", note: "Workers via OpenNext · docs/HOSTING.md has the commands. Env vars become Worker secrets." },
  { id: "other", name: "Other / self-host", note: "Anything that runs `next build && next start` behind a proxy." },
] as const;

export function SetupStudio() {
  const [siteUrl, setSiteUrl] = useState("");
  const [platform, setPlatform] = useState<(typeof PLATFORMS)[number]["id"]>("netlify");
  const [rpc, setRpc] = useState("");
  const [etherscan, setEtherscan] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "prod" | "error">("idle");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/setup/state", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { siteUrl?: string; platform?: string }) => {
        if (d.siteUrl) setSiteUrl(d.siteUrl);
        if (d.platform && PLATFORMS.some((p) => p.id === d.platform)) setPlatform(d.platform as typeof platform);
      })
      .catch(() => {});
  }, []);

  const urlOk = (() => {
    try {
      return /^https?:$/.test(new URL(siteUrl).protocol);
    } catch {
      return false;
    }
  })();
  const chosen = PLATFORMS.find((p) => p.id === platform)!;

  const apply = async () => {
    setState("busy");
    setMsg("");
    const r = await fetch("/api/setup/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteUrl, platform, rpc, etherscan }),
    }).catch(() => null);
    if (!r) {
      setState("error");
      setMsg("network error");
      return;
    }
    if (r.status === 403) {
      setState("prod");
      return;
    }
    const d = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) {
      setState("error");
      setMsg(d.error ?? "failed");
      return;
    }
    setState("done");
  };

  return (
    <MothershipShell>
      <AmbientBlooms />
      <main className="relative z-10 mx-auto max-w-[760px] px-5 pb-28 pt-10 md:pt-14">
        <div
          className="inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em]"
          style={{ borderColor: `${C.cyan}33`, background: `${C.cyan}14`, color: C.cyan }}
        >
          Integrator studio
        </div>
        <h1 className="mt-4 text-4xl font-black tracking-tight text-white sm:text-5xl">Set up your Mothership</h1>
        <p className="mt-3 max-w-[560px] text-[15px] leading-relaxed text-slate-400">
          Three values make this instance yours. In dev, Apply writes them into the project; on a live site,
          set the keys in your host&apos;s dashboard instead.
        </p>

        <div className="mt-8 space-y-5">
          <div className="rounded-2xl p-5" style={{ ...glass, borderTop: `2px solid ${C.green}80` }}>
            <label className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Your domain</label>
            <input
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              placeholder="https://prism.yourname.xyz"
              spellCheck={false}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-white/25"
              style={{ fontFamily: MONO }}
            />
            {!urlOk && siteUrl && <p className="mt-2 text-[11px] text-amber-300">Include the scheme, https://…</p>}
          </div>

          <div className="rounded-2xl p-5" style={{ ...glass, borderTop: `2px solid ${C.purple}80` }}>
            <label className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Hosting platform</label>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPlatform(p.id)}
                  className="rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors"
                  style={
                    platform === p.id
                      ? { borderColor: `${C.purple}66`, background: `${C.purple}1f`, color: "#fff" }
                      : { borderColor: "rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)", color: "#94a3b8" }
                  }
                >
                  {p.name}
                </button>
              ))}
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-slate-400">{chosen.note}</p>
          </div>

          <div className="rounded-2xl p-5" style={{ ...glass, borderTop: `2px solid ${C.cyan}80` }}>
            <label className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Alchemy API key · server-side, never shipped to visitors</label>
            <input
              value={rpc}
              onChange={(e) => setRpc(e.target.value)}
              placeholder="alcht_…"
              spellCheck={false}
              type="password"
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-white/25"
              style={{ fontFamily: MONO }}
            />
            <label className="mt-4 block text-[10px] uppercase tracking-[0.16em] text-slate-500">Etherscan API key · optional, live verified-badges</label>
            <input
              value={etherscan}
              onChange={(e) => setEtherscan(e.target.value)}
              placeholder="optional"
              spellCheck={false}
              type="password"
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-white outline-none focus:border-white/25"
              style={{ fontFamily: MONO }}
            />
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <button
              onClick={apply}
              disabled={!urlOk || state === "busy"}
              className="rounded-xl px-6 py-3 text-sm font-semibold text-white transition-all duration-300 hover:brightness-110 disabled:opacity-40"
              style={{ background: `linear-gradient(90deg, ${C.purple}, ${C.cyan})`, boxShadow: `0 0 20px ${C.purple}4d` }}
            >
              {state === "busy" ? "Applying…" : "Apply"}
            </button>
            {state === "done" && (
              <span className="text-sm font-semibold" style={{ color: C.green, ...glow(C.green) }}>
                Written: site.config.json + .env.local · run `npm run doctor` next.
              </span>
            )}
            {state === "error" && <span className="text-sm text-red-300">✖ {msg}</span>}
          </div>

          {state === "prod" && (
            <div className="rounded-2xl border p-5 text-[13px] leading-relaxed text-slate-300" style={{ borderColor: `${C.orange}4d`, background: `${C.orange}0d` }}>
              This is a deployed site, so Apply is disabled by design. Set these in your host&apos;s dashboard instead:
              <pre className="mt-3 overflow-x-auto rounded-xl bg-black/40 p-3 text-[12px]" style={{ fontFamily: MONO }}>
                {`ALCHEMY_API_KEY=${rpc ? "•••" : "<your key>"}\nETHERSCAN_API_KEY=${etherscan ? "•••" : "<optional>"}\nURL=${siteUrl || "<your domain>"}`}
              </pre>
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-slate-600">
            The chain wiring (PRISM token, pools, factories) ships canonical with the kit and is not editable
            here: integrators configure hosting, not contracts. Full runbook: START-HERE.md.
          </p>
        </div>
      </main>
    </MothershipShell>
  );
}
