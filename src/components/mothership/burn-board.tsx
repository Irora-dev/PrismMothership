"use client";

import { useCallback, useEffect, useState } from "react";
import { BrowserProvider, Contract, parseUnits } from "ethers";
import { NextBurnCard } from "@/components/charts/next-burn-card";
import { useWallet } from "@/lib/wallet/context";
import { fmtUsdFull } from "@/lib/feed/format";
import { C, MONO, glass, glow } from "./style";
import { AmbientBlooms } from "./blooms";

// ── THE BURN PIPELINE — what is flushable NOW, front and center ──────────────
// the designer's 0841 pass: "only show the ones actually at the threshold, all of the
// flushes next to each other in a horizontal line rather than a big list."
// So: a READY row of crankable cards leads; everything still accruing is one
// compact panel beneath, not fourteen rows. The honesty rail stays load-
// bearing: a flush on an L2 is a burn INITIATED, not completed — PRISM only
// dies at the L1 burner. Every crank simulates from the caller first, and
// min-outs are quoted fresh, never zero (a zero floor reverts by design).

interface Pipeline {
  ethUsd: number;
  baskets: {
    chain: string;
    address: string;
    symbol: string;
    pendingUsd: number;
    pendingEthEquiv: number;
    thresholdEth: number;
    crankable: boolean;
  }[];
  factories: { chain: string; address: string; note?: string; escrowEth: number }[];
  burner: { address: string; balanceEth: number };
  batcher: null;
}

const CHAIN_HEX: Record<string, string> = { ethereum: "0x1", base: "0x2105", robinhood: "0x1237" };
const CHAIN_LABEL: Record<string, string> = { ethereum: "Ethereum", base: "Base", robinhood: "Robinhood" };
const HOOD_ADD_PARAMS = {
  chainId: "0x1237",
  chainName: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://rpc.mainnet.chain.robinhood.com/rpc"],
  blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
};

type CrankState = { key: string; phase: "sim" | "wallet" | "mining" } | { key: string; phase: "error"; msg: string } | null;

function ChainChip({ chain }: { chain: string }) {
  return (
    <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-slate-400">
      {CHAIN_LABEL[chain] ?? chain}
    </span>
  );
}

interface ReadyItem {
  key: string;
  title: string;
  chain: string;
  amount: string;
  what: string;
  color: string;
  action: () => void;
}

export function BurnBoard() {
  const { wallet, account, openPicker } = useWallet();
  const [data, setData] = useState<Pipeline | null>(null);
  const [crank, setCrank] = useState<CrankState>(null);

  useEffect(() => {
    let alive = true;
    const tick = () =>
      fetch("/api/burn-pipeline", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d: Pipeline) => {
          if (alive) setData(d);
        })
        .catch(() => {});
    tick();
    const t = setInterval(tick, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // run one crank: right chain → simulate from the caller → send
  const runCrank = useCallback(
    async (key: string, chain: string, address: string, fnSig: string, args: bigint[]) => {
      if (!wallet || !account) {
        openPicker();
        return;
      }
      setCrank({ key, phase: "sim" });
      try {
        const want = CHAIN_HEX[chain];
        const have = (await wallet.provider.request({ method: "eth_chainId" })) as string;
        if (have !== want) {
          try {
            await wallet.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: want }] });
          } catch {
            if (chain === "robinhood") {
              await wallet.provider.request({ method: "wallet_addEthereumChain", params: [HOOD_ADD_PARAMS] });
            } else {
              throw new Error(`switch to ${CHAIN_LABEL[chain]} in your wallet`);
            }
          }
        }
        const provider = new BrowserProvider(wallet.provider);
        const signer = await provider.getSigner();
        const c = new Contract(address, [fnSig], signer);
        const fn = fnSig.slice(9, fnSig.indexOf("("));
        await c[fn].staticCall(...args); // must succeed before the wallet ever prompts
        setCrank({ key, phase: "wallet" });
        const tx = await c[fn](...args);
        setCrank({ key, phase: "mining" });
        await tx.wait();
        setCrank(null);
        fetch("/api/burn-pipeline", { cache: "no-store" }).then((r) => r.json()).then(setData).catch(() => {});
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setCrank(
          /user rejected|denied/i.test(msg)
            ? null
            : { key, phase: "error", msg: msg.includes("switch to") ? msg : "Simulation reverted. It may have just dropped below the threshold." },
        );
      }
    },
    [wallet, account, openPicker],
  );

  // min-outs, quoted fresh at crank time — never zero
  const crankBasket = useCallback(
    async (b: Pipeline["baskets"][number]) => {
      const key = `basket-${b.address}`;
      const ethEquiv = b.pendingEthEquiv;
      if (b.chain === "ethereum") {
        // the eth basket swap ends in PRISM → minPrismOut from the live quoter
        const q = await fetch(`/api/trade/quote?dir=buy&in=${ethEquiv}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (!q) {
          setCrank({ key, phase: "error", msg: "No PRISM quote available for the min-out. Try again." });
          return;
        }
        const minOut = parseUnits((Number(q.amountOut) * 0.95).toFixed(18), 18);
        runCrank(key, b.chain, b.address, "function flushPrismBurn(uint256)", [minOut]);
      } else {
        // base/robinhood swaps end in ETH → minEthOut
        const minOut = parseUnits((ethEquiv * 0.95).toFixed(18), 18);
        runCrank(key, b.chain, b.address, "function flushPrismBurn(uint256)", [minOut]);
      }
    },
    [runCrank],
  );

  const crankBurner = useCallback(async () => {
    if (!data) return;
    const key = "burner";
    const q = await fetch(`/api/trade/quote?dir=buy&in=${data.burner.balanceEth}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!q) {
      setCrank({ key, phase: "error", msg: "No PRISM quote available for the min-out. Try again." });
      return;
    }
    const minOut = parseUnits((Number(q.amountOut) * 0.95).toFixed(18), 18);
    runCrank(key, "ethereum", data.burner.address, "function flush(uint256)", [minOut]);
  }, [data, runCrank]);

  const crankLabel = (key: string, idle: string) => {
    if (crank && "key" in crank && crank.key === key && crank.phase !== "error") {
      return crank.phase === "sim" ? "Simulating…" : crank.phase === "wallet" ? "Confirm…" : "Mining…";
    }
    return idle;
  };
  const crankErr = (key: string) => (crank && crank.key === key && crank.phase === "error" ? crank.msg : null);
  const busy = crank != null && crank.phase !== "error";

  // ── everything flushable RIGHT NOW, as one horizontal band ──
  const ready: ReadyItem[] = data
    ? [
        ...data.factories
          .filter((f) => f.escrowEth > 0)
          .map((f) => ({
            key: `factory-${f.chain}-${f.address}`,
            title: f.note ? "Launch-fee escrow (legacy)" : "Launch-fee escrow",
            chain: f.chain,
            amount: `Ξ${f.escrowEth.toLocaleString("en-US", { maximumFractionDigits: 5 })}`,
            what: "Escrowed launch fees. Any amount flushes toward the burn.",
            color: C.purple,
            action: () => runCrank(`factory-${f.chain}-${f.address}`, f.chain, f.address, "function flushAuctionProceeds()", []),
          })),
        ...data.baskets
          .filter((b) => b.crankable)
          .map((b) => ({
            key: `basket-${b.address}`,
            title: `${b.symbol} burn accrual`,
            chain: b.chain,
            amount: fmtUsdFull(b.pendingUsd),
            what: "Basket fees held for the PRISM burn, over the threshold.",
            color: C.orange,
            action: () => crankBasket(b),
          })),
        ...(data.burner.balanceEth > 0
          ? [
              {
                key: "burner",
                title: "The L1 burner",
                chain: "ethereum",
                amount: `Ξ${data.burner.balanceEth.toLocaleString("en-US", { maximumFractionDigits: 5 })}`,
                what: "Buys PRISM through the pool and burns it forever.",
                color: C.green,
                action: () => crankBurner(),
              },
            ]
          : []),
      ]
    : [];

  const accruing = data ? data.baskets.filter((b) => !b.crankable && b.pendingUsd > 0).sort((a, b) => b.pendingEthEquiv - a.pendingEthEquiv) : [];
  const accruingTotal = accruing.reduce((a, b) => a + b.pendingUsd, 0);
  const topAccruing = accruing.slice(0, 5);

  return (
    <main className="relative z-10 mx-auto w-full max-w-[1152px] space-y-6 p-4 pb-14 sm:p-6 sm:pb-14">
      <AmbientBlooms />

      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Burn pipeline</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-400">
          Nothing here is automatic. The pipeline moves when someone pushes it, and anyone can: connect, flush, done. A
          flush on an L2 is a burn <em>initiated</em>, not completed. PRISM only dies at the L1 burner.
        </p>
      </div>

      {/* ── READY NOW — the horizontal flush line ── */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: C.green }} />
            <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: C.green }} />
          </span>
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Ready to flush right now</h2>
        </div>

        {!data ? (
          <div className="rounded-2xl p-6 text-sm text-slate-500" style={glass}>
            Reading the chains…
          </div>
        ) : ready.length === 0 ? (
          <div className="rounded-2xl p-6 text-sm leading-relaxed text-slate-400" style={glass}>
            Nothing is at its threshold right now. The accruals below are building toward one, and this row fills up on
            its own as they get there.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {ready.map((r) => (
              <div key={r.key} className="flex flex-col rounded-2xl p-5" style={{ ...glass, borderTop: `2px solid ${r.color}80` }}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-white">{r.title}</h3>
                  <ChainChip chain={r.chain} />
                </div>
                <div className="mt-3 text-3xl font-light tracking-tight text-white tabular-nums" style={{ fontFamily: MONO, ...glow(r.color) }}>
                  {r.amount}
                </div>
                <p className="mt-2 flex-1 text-[11px] leading-relaxed text-slate-500">{r.what}</p>
                <button
                  onClick={r.action}
                  disabled={busy}
                  className="mt-4 w-full rounded-lg py-2.5 text-xs font-bold text-white transition-all hover:brightness-110 disabled:opacity-50"
                  style={{ background: `linear-gradient(90deg, ${r.color}cc, ${C.cyan}cc)`, boxShadow: `0 0 12px ${r.color}4d` }}
                >
                  {crankLabel(r.key, account ? "Flush it" : "Connect & flush")}
                </button>
                {crankErr(r.key) && <p className="mt-2 text-[11px] text-red-300">{crankErr(r.key)}</p>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── building up + the rest of the pipeline, compact ── */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-2xl p-6" style={{ ...glass, borderTop: `2px solid ${C.orange}80` }}>
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Building toward the threshold</h2>
            {data && (
              <span className="text-sm font-semibold text-white tabular-nums" style={{ fontFamily: MONO }}>
                {fmtUsdFull(accruingTotal)}
              </span>
            )}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            Basket fees held back for the burn. Below ~0.3 Ξ-equivalent the flush reverts by design, so these wait
            here and graduate to the row above on their own.
          </p>
          {!data ? (
            <p className="mt-4 text-xs text-slate-600">Reading…</p>
          ) : topAccruing.length === 0 ? (
            <p className="mt-4 text-xs text-slate-600">No accruals yet. Fees land here as baskets trade.</p>
          ) : (
            <div className="mt-4 space-y-2.5">
              {topAccruing.map((b) => {
                const pct = Math.min(100, (b.pendingEthEquiv / b.thresholdEth) * 100);
                return (
                  <div key={b.address} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 truncate text-xs font-semibold text-white">{b.symbol}</span>
                    <ChainChip chain={b.chain} />
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/5">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(1, pct)}%`, background: `${C.orange}b3` }} />
                    </div>
                    <span className="w-16 shrink-0 text-right text-[11px] text-slate-400 tabular-nums" style={{ fontFamily: MONO }}>
                      {fmtUsdFull(b.pendingUsd)}
                    </span>
                  </div>
                );
              })}
              {accruing.length > topAccruing.length && (
                <p className="pt-1 text-[11px] text-slate-600">
                  …and {accruing.length - topAccruing.length} more baskets accruing.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <InFlight />
          <div className="flex-1 rounded-2xl p-6" style={glass}>
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Portfolio batcher</h2>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              Built and audited, awaiting its deploy ceremony. Its accrual and the bounty-paying flush join the row
              above the moment it is on-chain. Nothing is shown before it is real.
            </p>
          </div>
        </div>
      </section>

      <p className="text-center text-[11px] text-slate-600">
        Cranks execute from your wallet and are simulated from your address first. The batcher&apos;s flush will carry
        a 0.5% caller bounty when it ships; today&apos;s cranks pay nothing beyond the burn itself. Nothing on this
        page is investment advice.
      </p>
    </main>
  );
}

// The bridge leg rides the charts store's existing tracking — the same figures
// the deck's Next-big-burn card shows, in pipeline position.
function InFlight() {
  const [bridge, setBridge] = useState<{ pendingEth: number; nextBurnTs: number | null; ethUsd: number } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/charts?range=24h", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { bridge?: { pendingEth: number; nextBurnTs: number | null }; ethUsd?: number }) => {
        if (alive) setBridge({ pendingEth: d.bridge?.pendingEth ?? 0, nextBurnTs: d.bridge?.nextBurnTs ?? null, ethUsd: d.ethUsd ?? 0 });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!bridge) {
    return (
      <div className="rounded-2xl p-6 text-xs text-slate-600" style={glass}>
        Reading the bridges…
      </div>
    );
  }
  return <NextBurnCard pendingEth={bridge.pendingEth} nextBurnTs={bridge.nextBurnTs} ethUsd={bridge.ethUsd} />;
}
