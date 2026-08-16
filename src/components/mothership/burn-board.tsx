"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { BrowserProvider, Contract, parseUnits } from "ethers";
import { useWallet } from "@/lib/wallet/context";
import { usePolledJson } from "@/hooks/usePolledJson";
import { fmtEth, fmtPrism, fmtUsdFull } from "@/lib/feed/format";
import { BurnerCrankModal, CrankTotalsButtons, PendingBurnModal, collectorCrankable, type BurnerPot, type PendingCollector } from "@/components/pulse/crank-burn";
import { FinalizeCrankModal, type FinalizeTarget } from "@/components/pulse/finalize-crank";
import { addrUrl, txUrl } from "@/lib/chain/constants";
import { C, MONO, glass, glow } from "./style";
import { TimeAgo } from "./time-ago";
import { AmbientBlooms } from "./blooms";

// ── THE BURN PIPELINE — what is flushable NOW, front and center ──────────────
// the designer's 0841 pass: "only show the ones actually at the threshold, all of the
// flushes next to each other in a horizontal line rather than a big list."
// So: a READY row of crankable cards leads; everything still accruing is one
// compact panel beneath, not fourteen rows. The honesty rail stays load-
// bearing: a flush on an L2 is a burn INITIATED, not completed — PRISM only
// dies at the L1 burner. Every crank simulates from the caller first, and
// min-outs are quoted fresh, never zero (a zero floor reverts by design).

interface Withdrawal {
  chain: string;
  amountEth: number;
  caller: string;
  txHash: string;
  ts: number;
  unlockTs: number;
  position?: number | null; // Arbitrum-path rows carry their Outbox position; executable = the REAL gate
  status: "window" | "executable" | "landed";
}

interface BoardRow {
  address: string;
  valueEth: number;
  cranks: number;
  flushes: number;
  finalizes: number;
  burns: number;
  lastTs: number;
}

interface Pipeline {
  ethUsd: number;
  l1BaseFeeGwei?: number;
  policyPct?: number;
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
  // the bridge collectors, now with their crank economics (w-79)
  collectors?: PendingCollector[];
  // every flush() as its own withdrawal with its own clock and state
  withdrawals?: Withdrawal[];
  burner: {
    address: string;
    balanceEth: number;
    crankCostEth?: number | null;
    crankCostPct?: number | null;
    economic?: boolean;
    efficiencyPct?: number | null;
    burnedEthTotal?: number;
    burnedPrismTotal?: number;
    burnedEcosystemPrism?: number;
    lastBurn?: { caller: string; ethIn: number; prismBurned: number; ts: number; txHash: string } | null;
  };
  // the crank board: every cranker ranked by VALUE pushed, never count
  board?: BoardRow[];
  // LIVE since the 2026-08-16 gen-3 ceremony: measured off the production
  // batchers' own events (BatchExecuted = volume + fee · BurnShareDelivered =
  // ETH actually sent toward the burn). Deliberately NO PRISM figure: the
  // burner pot is fungible across every road, so a per-stream PRISM claim
  // would be an invention.
  batcher: { address: string; volumeUsd: number; feesUsd: number; deliveredEth: number; batches: number } | null;
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
  // usePolledJson instead of a swallowed catch: a dead pipeline route used to
  // leave this page loading forever with nothing saying why
  const { data, stale: readStale, refresh } = usePolledJson<Pipeline>("/api/burn-pipeline", 30_000);
  const [crank, setCrank] = useState<CrankState>(null);

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
        refresh(); // the crank just moved money — re-read now, not at the next poll
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setCrank(
          /user rejected|denied/i.test(msg)
            ? null
            : { key, phase: "error", msg: msg.includes("switch to") ? msg : "Simulation reverted. It may have just dropped below the threshold." },
        );
      }
    },
    [wallet, account, openPicker, refresh],
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

  // The burner's crank runs in its own popup and ends in a celebration with
  // the receipt's real bought-and-burnt figures — never a card that silently
  // disappears (the designer, 2026-08-16). Shared with the money map's chip.
  const [burnerCrank, setBurnerCrank] = useState<BurnerPot | null>(null);
  // the collector flush popup (the shared 4-stage modal with its economics)
  const [burnCrank, setBurnCrank] = useState<PendingCollector | null>(null);
  // the L1 finalize popup — a READY crossing's one-click executeTransaction
  const [finalizeCrank, setFinalizeCrank] = useState<FinalizeTarget | null>(null);

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
        // collector flushes and the burner crank now live on their ROAD
        // stations above — one owner per crank, so the two can never drift
      ]
    : [];

  const accruing = data ? data.baskets.filter((b) => !b.crankable && b.pendingUsd > 0).sort((a, b) => b.pendingEthEquiv - a.pendingEthEquiv) : [];
  const accruingTotal = accruing.reduce((a, b) => a + b.pendingUsd, 0);
  const topAccruing = accruing.slice(0, 5);

  return (
    <main className="relative z-10 mx-auto w-full max-w-[1152px] space-y-6 p-4 pb-14 sm:p-6 sm:pb-14">
      <AmbientBlooms />

      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">The burn crank</h1>
          <p className="mt-1 text-sm text-slate-400">Crank to trigger the burn. Any stage, anyone.</p>
        </div>
        {/* the page's two prime actions, hero-sized (the designer, 2026-08-16) */}
        <CrankTotalsButtons hero />
      </div>

      {readStale && (
        <div
          className="flex items-center gap-2 rounded-xl px-4 py-2 text-[11px]"
          style={{ background: "rgba(255,0,60,0.08)", border: "1px solid rgba(255,0,60,0.25)", color: "#fca5a5" }}
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: C.red }} />
          The pipeline read stopped answering. {data ? "These figures are the last ones that came through, not live." : "Still trying."}
        </div>
      )}

      {/* ── THE JOURNEY — the four states as one connected, flowing rail ── */}
      {data && (
        <div className="relative overflow-hidden rounded-2xl p-5" style={glass}>
          <div
            aria-hidden
            className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full blur-[110px]"
            style={{ background: `${C.orange}14` }}
          />
          <div className="relative flex flex-col items-stretch gap-2 md:flex-row">
            <JourneyTile
              label="Staged on the roads"
              figure={`Ξ${fmtEth(
                (data.collectors ?? []).reduce((a, c) => a + c.pendingEth, 0) +
                  data.baskets.reduce((a, b) => a + b.pendingEthEquiv, 0) +
                  data.factories.reduce((a, f) => a + f.escrowEth, 0),
              )}`}
              sub="waiting for a crank"
              color={C.orange}
            />
            <FlowLink active={(data.withdrawals ?? []).some((w) => w.status !== "landed")} color="#FACC15" />
            <JourneyTile
              label="Crossing the bridge"
              figure={`Ξ${fmtEth((data.withdrawals ?? []).filter((w) => w.status !== "landed").reduce((a, w) => a + w.amountEth, 0))}`}
              sub={(() => {
                const ready = (data.withdrawals ?? []).filter((w) => w.status === "executable").length;
                return ready > 0 ? `${ready} at the gate · READY TO FINALIZE` : "~7-day windows, then a finalize crank";
              })()}
              color="#FACC15"
            />
            <FlowLink active={data.burner.balanceEth > 0} color={C.red} />
            <JourneyTile label="At the burner" figure={`Ξ${fmtEth(data.burner.balanceEth)}`} sub="one crank from dead PRISM" color={C.red} />
            <FlowLink active={(data.burner.burnedPrismTotal ?? 0) > 0} color={C.green} />
            <JourneyTile
              label="Burned forever"
              figure={`${fmtPrism(data.burner.burnedEcosystemPrism ?? data.burner.burnedPrismTotal ?? 0)} PRISM`}
              sub={`every path counted · ${fmtPrism(data.burner.burnedPrismTotal ?? 0)} through the burner`}
              color={C.green}
              caustic
            />
          </div>
        </div>
      )}

      {/* ── THE CONVOY — every crossing, live on its ~7-day voyage ── */}
      {data && <BridgeConvoy withdrawals={data.withdrawals ?? []} ethUsd={data.ethUsd} onFinalize={setFinalizeCrank} />}

      {/* ── THE THREE ROADS — every chain's path to the burn, crankable in place ── */}
      <section>
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">The three roads to the burn</h2>
          {data?.l1BaseFeeGwei != null && data.l1BaseFeeGwei > 0 && (
            <span className="text-[10px] text-slate-500 tabular-nums" style={{ fontFamily: MONO }}>
              L1 gas {data.l1BaseFeeGwei.toFixed(data.l1BaseFeeGwei < 1 ? 3 : 1)} gwei · cranks light under {data.policyPct ?? 2}% cost
            </span>
          )}
        </div>
        {!data ? (
          <div className="rounded-2xl p-6 text-sm text-slate-500" style={glass}>
            Reading the chains…
          </div>
        ) : (
          <div className="space-y-3">
            <Road title="Ethereum" tag="the short path · one crank" dot="#e2e8f0">
              <Station
                label="Feeders"
                color={C.purple}
                title="Basket fees accruing toward their flush. Mainnet batches sink their burn cut straight into the pot in the same transaction: no bridge, no waiting."
              >
                <div className="text-2xl font-light tabular-nums text-white" style={{ fontFamily: MONO }}>
                  {fmtUsdFull(data.baskets.filter((b) => b.chain === "ethereum").reduce((a, b) => a + b.pendingUsd, 0))}
                  {data.factories.filter((x) => x.chain === "ethereum").reduce((a, x) => a + x.escrowEth, 0) > 0 && (
                    <span className="ml-2 text-[11px] text-slate-500">
                      + Ξ{fmtEth(data.factories.filter((x) => x.chain === "ethereum").reduce((a, x) => a + x.escrowEth, 0))} escrow
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-[11px] text-slate-500">batches sink straight into the pot</p>
              </Station>
              <FlowLink active={data.burner.balanceEth > 0} color={C.red} />
              <Station
                label="The burner pot"
                color={C.red}
                lit={data.burner.balanceEth > 0}
                title="ETH pooled from every road. flush(minPrismOut) buys PRISM through the pool and burns it. Permissionless, with the min-out quoted fresh."
              >
                <div className="text-2xl font-light tabular-nums text-white" style={{ fontFamily: MONO, ...(data.burner.balanceEth > 0 ? glow(C.red) : {}) }}>
                  Ξ{fmtEth(data.burner.balanceEth)}
                </div>
                {data.burner.balanceEth > 0 ? (
                  data.burner.economic !== false ? (
                    <>
                      <button
                        onClick={() => setBurnerCrank(data.burner)}
                        className="mt-3 w-full rounded-lg py-2 text-xs font-bold text-white transition-all hover:brightness-110"
                        style={{ background: `linear-gradient(90deg, ${C.red}cc, ${C.orange}cc)`, boxShadow: `0 0 12px ${C.red}4d` }}
                      >
                        Crank the burn
                      </button>
                      {data.burner.efficiencyPct != null && (
                        <p className="mt-1.5 text-center text-[10px] font-semibold tabular-nums" style={{ color: C.green }}>
                          ≈{data.burner.efficiencyPct.toFixed(1)}% efficient
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="mt-2 text-[11px] text-slate-500">
                      Waiting for a fatter pot.{" "}
                      {data.burner.crankCostPct == null
                        ? "Cranking now costs too much of it."
                        : data.burner.crankCostPct > 100
                          ? "Cranking now would cost more than it delivers."
                          : `Cranking now costs ${data.burner.crankCostPct.toFixed(0)}% of it.`}
                    </p>
                  )
                ) : (
                  <p className="mt-2 text-[11px] text-slate-500">Empty. Every road fills it.</p>
                )}
              </Station>
              <FlowLink active={(data.burner.burnedPrismTotal ?? 0) > 0} color={C.green} />
              <Station
                label="The last burn"
                color={C.green}
                lit={data.burner.lastBurn != null}
                title="The most recent buy-and-burn through the pot, as its own receipt. The journey rail above carries the lifetime total."
              >
                {data.burner.lastBurn ? (
                  <>
                    <div className="text-2xl font-light tabular-nums text-white" style={{ fontFamily: MONO, ...glow(C.green) }}>
                      {fmtPrism(data.burner.lastBurn.prismBurned)} <span className="text-[11px] text-slate-500">PRISM</span>
                    </div>
                    <a
                      href={txUrl(data.burner.lastBurn.txHash, "ethereum")}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold tabular-nums transition-all hover:brightness-125"
                      style={{ borderColor: `${C.green}40`, background: `${C.green}0d`, color: C.green, fontFamily: MONO }}
                    >
                      Ξ{fmtEth(data.burner.lastBurn.ethIn)} · <TimeAgo ts={data.burner.lastBurn.ts} short className="text-[10px]" /> · tx ↗
                    </a>
                  </>
                ) : (
                  <p className="mt-2 text-[11px] text-slate-500">No burn yet. Yours could be the first.</p>
                )}
              </Station>
            </Road>

            <Road title="Robinhood" tag="three cranks · finalize ≈91k gas" dot="#CCFF00">
              <CollectorRoad chain="robinhood" data={data} onFlush={setBurnCrank} onFinalize={setFinalizeCrank} />
            </Road>

            <Road title="Base" tag="three cranks · finalize ≈600k gas, two txs" dot="#0052FF">
              <CollectorRoad chain="base" data={data} onFlush={setBurnCrank} onFinalize={setFinalizeCrank} />
            </Road>
          </div>
        )}
      </section>

      {/* ── FEEDER CRANKS — the horizontal flush line ── */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: C.green }} />
            <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: C.green }} />
          </span>
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Feeder cranks · ready right now</h2>
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
              <div key={r.key} title={r.what} className="flex flex-col rounded-2xl p-5" style={{ ...glass, borderTop: `2px solid ${r.color}80` }}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-white">{r.title}</h3>
                  <ChainChip chain={r.chain} />
                </div>
                <div className="mt-3 text-3xl font-light tracking-tight text-white tabular-nums" style={{ fontFamily: MONO, ...glow(r.color) }}>
                  {r.amount}
                </div>
                <div className="flex-1" />
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
            <h2
              className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400"
              title="Basket fees held back for the burn. Below ~0.3 Ξ-equivalent the flush reverts by design, so these graduate to the feeder row on their own."
            >
              Building toward the threshold
            </h2>
            {data && (
              <span className="text-sm font-semibold text-white tabular-nums" style={{ fontFamily: MONO }}>
                {fmtUsdFull(accruingTotal)}
              </span>
            )}
          </div>

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

        <CrankBoard board={data?.board ?? []} ethUsd={data?.ethUsd ?? 0} />
      </section>

      <BurnStreams batcher={data?.batcher ?? null} />

      {burnerCrank && (
        <BurnerCrankModal
          burner={burnerCrank}
          ethUsd={data?.ethUsd ?? 0}
          onClose={() => setBurnerCrank(null)}
          onDone={refresh}
        />
      )}
      {burnCrank && (
        <PendingBurnModal
          collector={burnCrank}
          ethUsd={data?.ethUsd ?? 0}
          onClose={() => setBurnCrank(null)}
          onDone={() => {
            setBurnCrank(null);
            refresh(); // the crank just moved money — the station must retire NOW
          }}
        />
      )}
      {finalizeCrank && (
        <FinalizeCrankModal
          target={finalizeCrank}
          ethUsd={data?.ethUsd ?? 0}
          onClose={() => setFinalizeCrank(null)}
          onDone={refresh} // the delivery just filled the pot — re-read, don't wait for the poll
        />
      )}

      <p className="text-center text-[11px] text-slate-600">
        Every crank simulates from your address before your wallet ever prompts. Nothing on this page is investment advice.
      </p>
    </main>
  );
}

// ── WHERE THE BURN COMES FROM — the two streams, side by side ────────────────
// R asked (2026-08-02, via the designer's spec): "the burn from this system should be
// surfaced somewhere" — and the designer specced the shape: "portfolio volume,
// portfolio burn and buy, and then basket volume, basket burn." So each stream
// gets its own card, its own traded volume, and its own PRISM.
//
// Two rules this card must never break:
//   1. NEVER derive burn from volume × a fee rate. Baskets differ by lineage
//      (every deployed one reads BURN_SHARE_BPS = 1000 today; the ruled 2500
//      ships with the lineage rev and is immutable per basket), so a single
//      rate is wrong the moment two generations trade. Read observed figures.
//   2. The portfolio stream renders NOTHING until its batcher is on chain —
//      not a zero, not a projection. The route's `batcher` field gates it, so
//      the card lights up on its own the day the ceremony seats an address.
//
// ⚠️ The seat-the-batcher note resolved (gen-3 ceremony, 2026-08-16): the
// burner pot is FUNGIBLE across roads, so rather than subtracting deliveries
// to fake a per-stream PRISM figure, the portfolio card claims only what its
// own events measure — funding volume and ETH actually sent toward the burn.
// The basket card keeps its PRISM figure (burner → dEaD transfers), and the
// moment portfolio deliveries join the pot its sub says the pot is shared.
function BurnStreams({ batcher }: { batcher: Pipeline["batcher"] }) {
  const [spec, setSpec] = useState<{ volumeUsd: number; queuedUsd: number; burnedPrism: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/spectrum/charts?range=1y", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("spectrum charts unavailable"))))
      .then((d: { buyVolumeUsd?: number[]; sellVolumeUsd?: number[]; queuedBurnUsd?: number; auctionPipeline?: { burnedPrism?: number } }) => {
        if (!alive) return;
        const sum = (a?: number[]) => (a ?? []).reduce((x, y) => x + (y || 0), 0);
        setSpec({
          volumeUsd: sum(d.buyVolumeUsd) + sum(d.sellVolumeUsd),
          queuedUsd: d.queuedBurnUsd ?? 0,
          burnedPrism: d.auctionPipeline?.burnedPrism ?? 0,
        });
      })
      // a swallowed failure reads as an eternal "—"; say the read failed instead
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const dash = "—";
  const cards = [
    {
      key: "baskets",
      title: "Baskets",
      color: C.orange,
      live: true,
      volume: spec ? fmtUsdFull(spec.volumeUsd) : dash,
      stat2Label: "bought & burnt",
      stat2: spec ? `${spec.burnedPrism.toLocaleString("en-US", { maximumFractionDigits: 4 })} PRISM` : dash,
      note:
        spec && spec.burnedPrism === 0 && spec.queuedUsd > 0
          ? "Every basket fee sets a slice aside for PRISM. Nothing has been bought yet. The queued figure is waiting on its first flush, and anyone can push it."
          : batcher && batcher.deliveredEth > 0
            ? "Every basket fee sets a slice aside for PRISM and dies at the L1 burner. The burner pot is shared: portfolio deliveries join it, so this PRISM figure is the pot's, not baskets' alone."
            : "Every basket fee sets a slice aside for PRISM. It queues on the basket, flushes toward the L1 burner, and dies there.",
    },
    {
      key: "portfolio",
      title: "Spectrum Portfolio",
      color: C.purple,
      live: batcher != null,
      volume: batcher ? fmtUsdFull(batcher.volumeUsd) : dash,
      // measured only: ETH its events delivered toward the burn. The pot is
      // fungible, so no per-stream PRISM number exists to state honestly.
      stat2Label: "sent to the burn",
      stat2: batcher ? `Ξ${fmtEth(batcher.deliveredEth)}` : dash,
      note: batcher
        ? batcher.batches > 0
          ? "Every batched buy pays its fee on the way in; the whole fee is sent toward the burner, where it buys PRISM and dies."
          : "The production batchers are live on all three chains (the 2026-08-16 ceremony). These figures count up from the first real batch."
        : "Built and audited, waiting on its deploy ceremony. Nothing is shown before it is real.",
    },
  ];

  return (
    <section className="rounded-2xl p-5" style={glass}>
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Where the burn comes from</h2>
        {failed && <span className="text-[11px] text-red-300">The stream read failed. Figures unavailable.</span>}
      </div>
      {!spec && !failed ? (
        <p className="text-xs text-slate-600">Reading the streams…</p>
      ) : (
        <div className="space-y-2">
          {cards.map((c) => (
            <div
              key={c.key}
              title={c.note}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border px-3.5 py-2.5"
              style={{ borderColor: c.live ? `${c.color}33` : "rgba(255,255,255,0.06)", background: c.live ? `${c.color}08` : "rgba(255,255,255,0.02)" }}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c.color, boxShadow: c.live ? `0 0 8px ${c.color}` : "none" }} />
              <span className={`w-40 shrink-0 text-[13px] font-bold ${c.live ? "text-white" : "text-slate-500"}`}>{c.title}</span>
              <span className="min-w-0 flex-1 text-[11px] text-slate-500">
                traded 12m{" "}
                <span className="text-[13px] font-semibold tabular-nums" style={{ fontFamily: MONO, color: c.live ? "#fff" : "#64748b" }}>
                  {c.volume}
                </span>
              </span>
              <span className="text-[11px] text-slate-500">
                {c.stat2Label}{" "}
                <span className="text-[13px] font-semibold tabular-nums" style={{ fontFamily: MONO, color: c.live ? c.color : "#64748b" }}>
                  {c.stat2}
                </span>
              </span>
              <span className="ml-auto shrink-0 text-[9px] uppercase tracking-wider" style={{ color: c.live ? `${C.green}b3` : "rgb(100,116,139)" }}>
                {c.live ? "live" : "not on-chain yet"}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── THE ROADS' PIECES ─────────────────────────────────────────────────────────
// (The old InFlight aggregate card is superseded: the bridge is now shown
// per-withdrawal on its road, each with its own clock and state.)

function JourneyTile({ label, figure, sub, color, caustic }: { label: string; figure: string; sub: string; color: string; caustic?: boolean }) {
  return (
    <div className="min-w-0 flex-1 rounded-xl p-3.5" style={{ background: `${color}0a`, border: `1px solid ${color}26` }}>
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</span>
      </div>
      <div className="mt-2 text-3xl font-light tracking-tight text-white tabular-nums" style={{ fontFamily: MONO, ...glow(color) }}>
        {figure}
      </div>
      <div className="mt-1 text-[10px] text-slate-500">{sub}</div>
      {caustic && (
        <div
          aria-hidden
          className="mt-2.5 h-[3px] w-24 rounded-full"
          style={{ background: "linear-gradient(90deg, #ff5a5a, #ff9f45, #ffe14d, #5cff8f, #3bd9ff, #7c8bff, #c06aff)", filter: "blur(0.4px)" }}
        />
      )}
    </div>
  );
}

function Road({ title, tag, dot, children }: { title: string; tag: string; dot: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-4" style={glass}>
      <div className="mb-3 flex items-baseline gap-3">
        <span className="h-2 w-2 shrink-0 self-center rounded-full" style={{ background: dot, boxShadow: `0 0 8px ${dot}66` }} aria-hidden />
        <h3 className="text-sm font-bold text-white">{title}</h3>
        <span className="text-[10px] uppercase tracking-wider text-slate-500">{tag}</span>
      </div>
      <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-stretch">{children}</div>
    </div>
  );
}

function Station({ label, color, lit, title, children }: { label: string; color: string; lit?: boolean; title?: string; children: React.ReactNode }) {
  return (
    <div
      className="min-w-0 flex-1 rounded-xl border p-3.5"
      title={title}
      style={{ borderColor: lit ? `${color}59` : "rgba(255,255,255,0.08)", background: lit ? `${color}0d` : "rgba(255,255,255,0.02)" }}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: color, boxShadow: lit ? `0 0 8px ${color}` : "none" }} />
        <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</span>
      </div>
      {children}
    </div>
  );
}

/** The joint between stations: money drifts toward the burn. Reuses the fee
 *  pipeline's ms-flow keyframes (already reduced-motion-covered); still and
 *  dim while the downstream stage is empty. */
function FlowLink({ active, color }: { active: boolean; color: string }) {
  return (
    <div aria-hidden className="relative mx-auto h-6 w-px shrink-0 md:my-auto md:mx-0 md:h-px md:w-7" style={{ background: `${color}2e` }}>
      {[0, 1].map((i) => (
        <span
          key={`x${i}`}
          className="absolute hidden h-1 w-1 rounded-full md:block"
          style={{
            background: color,
            boxShadow: `0 0 6px ${color}`,
            opacity: active ? 1 : 0.15,
            top: "50%",
            marginTop: -2,
            animation: active ? `ms-flow-x 2.2s linear ${i * 1.1}s infinite` : "none",
          }}
        />
      ))}
      {[0, 1].map((i) => (
        <span
          key={`y${i}`}
          className="absolute h-1 w-1 rounded-full md:hidden"
          style={{
            background: color,
            boxShadow: `0 0 6px ${color}`,
            opacity: active ? 1 : 0.15,
            left: "50%",
            marginLeft: -2,
            animation: active ? `ms-flow-y 2.2s linear ${i * 1.1}s infinite` : "none",
          }}
        />
      ))}
    </div>
  );
}

/** One L2 road: feeders → the collector (flush crank) → the bridge, each
 *  withdrawal with its own clock. Landing on the pot is the Ethereum road's
 *  business from there. */
function CollectorRoad({ chain, data, onFlush, onFinalize }: { chain: "base" | "robinhood"; data: Pipeline; onFlush: (c: PendingCollector) => void; onFinalize: (w: FinalizeTarget) => void }) {
  // Two collector generations run in parallel per chain since the gen-3
  // ceremony (production + the gen-1 one the rehearsal decoys still feed).
  // The figure is the chain's TOTAL staged burn; the crank targets the best
  // crankable collector (one press, one tx), and the bar tracks the primary —
  // the one holding the most, production on a tie.
  const gens = (data.collectors ?? []).filter((c) => c.chain === chain);
  const crankTarget = gens.filter(collectorCrankable).sort((a, b) => b.pendingEth - a.pendingEth)[0] ?? null;
  const collector = crankTarget ?? [...gens].sort((a, b) => b.pendingEth - a.pendingEth || (b.gen ?? 1) - (a.gen ?? 1))[0] ?? null;
  const stagedTotal = gens.reduce((a, c) => a + c.pendingEth, 0);
  const secondaryEth = stagedTotal - (collector?.pendingEth ?? 0);
  const withdrawals = (data.withdrawals ?? []).filter((w) => w.chain === chain);
  const feederUsd = data.baskets.filter((b) => b.chain === chain).reduce((a, b) => a + b.pendingUsd, 0);
  const crankable = crankTarget != null;
  const pct = collector?.finalizeCostPct ?? null;
  return (
    <>
      <Station
        label="Feeders"
        color={C.purple}
        title="Basket fees accruing toward their flush, batch burn cuts arriving as ETH, and launch-fee escrow (cranked from the feeder row below)."
      >
        <div className="text-2xl font-light tabular-nums text-white" style={{ fontFamily: MONO }}>
          {fmtUsdFull(feederUsd)}
        </div>
        <p className="mt-1.5 text-[11px] text-slate-500">batch burn cuts land on the collector</p>
      </Station>
      <FlowLink active={(collector?.pendingEth ?? 0) > 0} color={C.orange} />
      <Station
        label="The collector"
        color={C.orange}
        lit={crankable}
        title="The batcher's burn cut pools here. flush() is permissionless and opens one L2-to-L1 withdrawal. The crank lights when its later finalization costs under 2% of the value."
      >
        <div className="text-2xl font-light tabular-nums text-white" style={{ fontFamily: MONO, ...(crankable ? glow(C.orange) : {}) }}>
          Ξ{fmtEth(stagedTotal)}
        </div>
        {secondaryEth > 0.0001 && (
          <p className="mt-0.5 text-[10px] text-slate-500">Ξ{fmtEth(secondaryEth)} of that sits on the other collector generation</p>
        )}
        {collector && collector.thresholdEth != null && collector.thresholdEth > 0 && (
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.max(2, Math.min(100, (collector.pendingEth / collector.thresholdEth) * 100))}%`, background: `${C.orange}b3` }}
            />
          </div>
        )}
        {crankable && crankTarget ? (
          <>
            <button
              onClick={() => onFlush(crankTarget)}
              className="mt-3 w-full rounded-lg py-2 text-xs font-bold text-white transition-all hover:brightness-110"
              style={{ background: `linear-gradient(90deg, ${C.orange}cc, ${C.cyan}cc)`, boxShadow: `0 0 12px ${C.orange}4d` }}
            >
              Flush toward the burn
            </button>
            {collector?.efficiencyPct != null && (
              <p className="mt-1.5 text-center text-[10px] font-semibold tabular-nums" style={{ color: C.green }}>
                ≈{collector.efficiencyPct.toFixed(1)}% efficient
              </p>
            )}
          </>
        ) : (
          <p className="mt-2 text-[11px] text-slate-500">
            {collector == null || stagedTotal <= 0
              ? "Empty · fills on the next batch"
              : !collector.flushable
                ? `below the Ξ${fmtEth(collector.thresholdEth ?? 0)} floor · fatter batches win`
                : pct != null && pct > (data.policyPct ?? 2)
                  ? pct > 100
                    ? "finalizing now costs more than it delivers · waiting wins"
                    : `finalizing now costs ${pct.toFixed(pct >= 10 ? 0 : 1)}% · waiting wins`
                  : "waiting for the economics to clear"}
          </p>
        )}
      </Station>
      <FlowLink active={withdrawals.some((w) => w.status !== "landed")} color="#FACC15" />
      <Station
        label="On the voyage"
        color="#FACC15"
        lit={withdrawals.some((w) => w.status === "executable")}
        title="Each flush opens one ~7-day withdrawal. The convoy above tracks every crossing; after its window, finalizing on L1 is its own permissionless crank."
      >
        {(() => {
          const sailing = withdrawals.filter((w) => w.status !== "landed");
          const executable = sailing.filter((w) => w.status === "executable").sort((a, b) => a.ts - b.ts);
          if (sailing.length === 0) return <p className="mt-1 text-[11px] text-slate-500">Nothing crossing.</p>;
          const total = sailing.reduce((a, w) => a + w.amountEth, 0);
          const nextTs = Math.min(...sailing.map((w) => w.unlockTs));
          return (
            <>
              <div className="text-2xl font-light tabular-nums text-white" style={{ fontFamily: MONO, ...(executable.length ? glow(C.red) : {}) }}>
                Ξ{fmtEth(total)} <span className="text-[11px] text-slate-500">· {sailing.length} crossing{sailing.length === 1 ? "" : "s"}</span>
              </div>
              {executable.length > 0 && chain === "robinhood" ? (
                <>
                  {/* one press, one tx: the oldest crossing at the gate first */}
                  <button
                    onClick={() => onFinalize(executable[0])}
                    className="mt-3 w-full rounded-lg py-2 text-xs font-bold transition-all hover:brightness-110"
                    style={{ background: "linear-gradient(90deg, #FACC15cc, #FF5E00cc)", color: "#181000", boxShadow: "0 0 12px rgba(250,204,21,0.35)" }}
                  >
                    Finalize on L1 · Ξ{fmtEth(executable[0].amountEth)}
                  </button>
                  {executable.length > 1 && (
                    <p className="mt-1.5 text-center text-[10px] text-slate-500">{executable.length} at the gate · oldest first, one tx each</p>
                  )}
                </>
              ) : (
                <p className="mt-1.5 text-[11px] text-slate-500">
                  {executable.length > 0
                    ? `${executable.length} READY TO FINALIZE · a two-tx OP-Stack claim, not one-click yet`
                    : `next finalize ~${new Date(nextTs).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · tracked on the convoy`}
                </p>
              )}
            </>
          );
        })()}
      </Station>
    </>
  );
}




// ── THE CONVOY — every crossing as a packet on its ~7-day voyage ─────────────
// Each collector flush opens one L2→L1 withdrawal; here it sails a dotted
// route from its chain's berth toward the burner, its position the REAL share
// of its dispute window already served. Executable packets wait at the gate,
// pulsing. Every packet is a receipt (click = the flush tx).

function cubicAt(p0: number[], p1: number[], p2: number[], p3: number[], t: number): [number, number] {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
}

const CONVOY_ROUTES: Record<"robinhood" | "base", { pts: number[][]; color: string; label: string }> = {
  robinhood: { pts: [[150, 64], [390, 36], [680, 72], [902, 104]], color: "#CCFF00", label: "Robinhood" },
  base: { pts: [[150, 172], [390, 200], [680, 158], [902, 120]], color: "#0052FF", label: "Base" },
};

function BridgeConvoy({ withdrawals, ethUsd, onFinalize }: { withdrawals: Withdrawal[]; ethUsd: number; onFinalize: (w: FinalizeTarget) => void }) {
  const open = withdrawals.filter((w) => w.status !== "landed");
  const now = Date.now();
  const W = 1000;
  const H = 252;
  const pathOf = (r: { pts: number[][] }) =>
    `M ${r.pts[0][0]} ${r.pts[0][1]} C ${r.pts[1][0]} ${r.pts[1][1]}, ${r.pts[2][0]} ${r.pts[2][1]}, ${r.pts[3][0]} ${r.pts[3][1]}`;

  return (
    <section className="relative overflow-hidden rounded-2xl p-5" style={glass}>
      <div aria-hidden className="pointer-events-none absolute -right-10 top-1/2 h-72 w-72 -translate-y-1/2 rounded-full blur-[100px]" style={{ background: `${C.red}16` }} />
      <div aria-hidden className="pointer-events-none absolute -left-16 -top-16 h-56 w-56 rounded-full blur-[110px]" style={{ background: "#CCFF0010" }} />
      <div className="relative mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">The convoy · crossings in flight</h2>
        <span className="text-[11px] text-slate-500">position = real time served of the ~7-day window</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" aria-hidden={open.length === 0}>
        <defs>
          <linearGradient id="convoy-burner-edge" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffe14d" />
            <stop offset="100%" stopColor="#ff0a3c" />
          </linearGradient>
          {/* each route warms from its chain's color toward the fire */}
          {(Object.keys(CONVOY_ROUTES) as ("robinhood" | "base")[]).map((chain) => {
            const r = CONVOY_ROUTES[chain];
            return (
              <linearGradient key={chain} id={`convoy-route-${chain}`} gradientUnits="userSpaceOnUse" x1={r.pts[0][0]} y1="0" x2={r.pts[3][0]} y2="0">
                <stop offset="0%" stopColor={r.color} />
                <stop offset="72%" stopColor={r.color} />
                <stop offset="100%" stopColor="#FF5E00" />
              </linearGradient>
            );
          })}
          <filter id="mmm-soft-convoy" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
          <linearGradient id="mmm-caustic-convoy" gradientUnits="userSpaceOnUse" x1="900" y1="0" x2="956" y2="0">
            {["#ff5a5a", "#ff9f45", "#ffe14d", "#5cff8f", "#3bd9ff", "#7c8bff", "#c06aff"].map((c, i) => (
              <stop key={c} offset={`${(i / 6) * 100}%`} stopColor={c} stopOpacity="0.85" />
            ))}
          </linearGradient>
        </defs>
        {(Object.keys(CONVOY_ROUTES) as ("robinhood" | "base")[]).map((chain) => {
          const r = CONVOY_ROUTES[chain];
          const packets = open.filter((w) => w.chain === chain).sort((a, b) => a.ts - b.ts);
          const active = packets.length > 0;
          return (
            <g key={chain}>
              {/* the berth: a lit node wearing its chain's color */}
              <circle cx={r.pts[0][0] - 26} cy={r.pts[0][1]} r={12} fill={r.color} opacity={active ? 0.16 : 0.06} filter="url(#mmm-soft-convoy)" />
              <circle cx={r.pts[0][0] - 26} cy={r.pts[0][1]} r={5.5} fill={r.color} opacity={active ? 0.95 : 0.35} />
              <circle cx={r.pts[0][0] - 26} cy={r.pts[0][1]} r={8.5} fill="none" stroke={r.color} strokeOpacity={active ? 0.4 : 0.15} />
              <text x={r.pts[0][0] - 44} y={r.pts[0][1] + 4.5} textAnchor="end" fontSize="13" fontWeight="700" fill={active ? "#e8edf4" : "#64748b"}>
                {r.label}
              </text>
              {/* the route: a glowing lane, marching toward the burner */}
              <path d={pathOf(r)} fill="none" stroke={r.color} strokeOpacity={active ? 0.14 : 0.05} strokeWidth={10} filter="url(#mmm-soft-convoy)" />
              <path
                d={pathOf(r)}
                fill="none"
                stroke={`url(#convoy-route-${chain})`}
                strokeOpacity={active ? 0.65 : 0.18}
                strokeWidth={1.8}
                strokeDasharray="3 10"
                strokeLinecap="round"
                style={active ? { animation: "ms-beam-flow 2.4s linear infinite" } : undefined}
              />
              {/* quarter-way ticks */}
              {[0.25, 0.5, 0.75].map((t) => {
                const [x, y] = cubicAt(r.pts[0], r.pts[1], r.pts[2], r.pts[3], t);
                return <circle key={t} cx={x} cy={y} r={1.8} fill="#94a3b8" opacity="0.4" />;
              })}
              {/* the packets: dots sail the route; their glass plates dock
                  along the card's bottom (a plate floated above an early
                  caravan clipped at the panel edge — the designer, 2026-08-16) */}
              {(() => {
                const drawn = packets.slice(0, 6).map((w) => {
                  const ready = w.status === "executable";
                  const t = ready ? 0.97 : Math.min(0.94, Math.max(0.03, (now - w.ts) / Math.max(1, w.unlockTs - w.ts)));
                  return { w, ready, t };
                });
                const clusters: { items: typeof drawn }[] = [];
                for (const d of drawn) {
                  const last = clusters[clusters.length - 1];
                  if (last && Math.abs(d.t - last.items[last.items.length - 1].t) < 0.05) last.items.push(d);
                  else clusters.push({ items: [d] });
                }
                const etaOf = (w: Withdrawal) => {
                  const left = w.unlockTs - now;
                  return left >= 86_400_000 ? `~${Math.ceil(left / 86_400_000)}d` : left > 0 ? `~${Math.max(1, Math.ceil(left / 3_600_000))}h` : "";
                };
                // hood plates dock left-of-center, base right, both on the floor
                const plateY = H - 56;
                let cursorX = chain === "robinhood" ? 16 : W / 2 + 8;
                return clusters.map((cl, ci) => {
                  const anyReady = cl.items.some((d) => d.ready);
                  const mid = cl.items.reduce((a, d) => a + d.t, 0) / cl.items.length;
                  const [cx, cy] = cubicAt(r.pts[0], r.pts[1], r.pts[2], r.pts[3], mid);
                  const total = cl.items.reduce((a, d) => a + d.w.amountEth, 0);
                  const first = cl.items.reduce((a, d) => (d.w.unlockTs < a.w.unlockTs ? d : a));
                  const col = anyReady ? C.red : r.color;
                  const readyOldest = cl.items.filter((d) => d.ready).sort((a, b) => a.w.ts - b.w.ts)[0]?.w ?? null;
                  const oneClick = chain === "robinhood"; // Base's claim is a two-tx OP-Stack flow, not one-click yet
                  const line2 = anyReady
                    ? oneClick
                      ? "READY TO FINALIZE · crank it →"
                      : "READY TO FINALIZE"
                    : cl.items.length === 1
                      ? `${Math.round(mid * 100)}% across · finalize in ${etaOf(first.w)}`
                      : `${Math.round(Math.min(...cl.items.map((d) => d.t)) * 100)}–${Math.round(Math.max(...cl.items.map((d) => d.t)) * 100)}% across · first finalize in ${etaOf(first.w)}`;
                  const line1len = `Ξ${fmtEth(total)}  ${ethUsd > 0 ? fmtUsdFull(total * ethUsd) : ""}  ${cl.items.length > 1 ? `·  ${cl.items.length} crossings` : ""}`.length;
                  const plateW = Math.max(line1len * 8.2, line2.length * 6.2) + 30;
                  const plateX = Math.max(10, Math.min(W - plateW - 10, Math.max(cursorX, cx - plateW / 2)));
                  cursorX = plateX + plateW + 12;
                  return (
                    <g key={`cl-${ci}`}>
                      {cl.items.map((d, i) => {
                        const t = Math.min(0.97, d.t + i * 0.018);
                        const [x, y] = cubicAt(r.pts[0], r.pts[1], r.pts[2], r.pts[3], t);
                        const dcol = d.ready ? C.red : r.color;
                        const dots = (
                          <>
                            <title>{`Ξ${fmtEth(d.w.amountEth)}${ethUsd > 0 ? ` (${fmtUsdFull(d.w.amountEth * ethUsd)})` : ""} flushed ${r.label} → the burner · ${d.ready ? (oneClick ? "READY: open the one-click L1 finalize" : "past its window: the L1 finalization crank is open") : `finalize opens in ${etaOf(d.w)} · open the flush tx`}`}</title>
                            <circle cx={x} cy={y} r={14} fill={dcol} opacity="0.18" filter="url(#mmm-soft-convoy)" style={{ animation: "mm-breathe 3.4s ease-in-out infinite" }} />
                            <circle cx={x} cy={y} r={5.5} fill={dcol} opacity="0.95" />
                            <circle cx={x} cy={y} r={8.5} fill="none" stroke={dcol} strokeOpacity="0.45" />
                          </>
                        );
                        // a READY packet's click-want is the crank, not the explorer —
                        // the modal itself links the flush tx (the map's own rule)
                        return d.ready && oneClick ? (
                          <g key={d.w.txHash} onClick={() => onFinalize(d.w)} style={{ cursor: "pointer" }} role="button" aria-label="Finalize this crossing on L1">
                            {dots}
                          </g>
                        ) : (
                          <a key={d.w.txHash} href={txUrl(d.w.txHash, chain)} target="_blank" rel="noopener noreferrer">
                            {dots}
                          </a>
                        );
                      })}
                      {/* the leader ties the caravan to its docked plate */}
                      <line x1={cx} y1={cy + 12} x2={plateX + plateW / 2} y2={plateY} stroke={col} strokeOpacity="0.28" strokeDasharray="2 4" />
                      <g
                        onClick={readyOldest && oneClick ? () => onFinalize(readyOldest) : undefined}
                        style={readyOldest && oneClick ? { cursor: "pointer" } : undefined}
                        role={readyOldest && oneClick ? "button" : undefined}
                        aria-label={readyOldest && oneClick ? "Finalize the oldest ready crossing on L1" : undefined}
                      >
                        <rect x={plateX} y={plateY} width={plateW} height={46} rx={10} fill="rgba(5,7,14,0.85)" stroke={`${col}59`} />
                        <circle cx={plateX + 15} cy={plateY + 15} r={3.5} fill={col} />
                        <text x={plateX + 26} y={plateY + 20} fontSize="15" fontWeight="700" fill="#ffffff" fontFamily="ui-monospace, monospace">
                          {`Ξ${fmtEth(total)}`}
                          {ethUsd > 0 && <tspan fill="#8b9bb0" fontSize="13">{`  ${fmtUsdFull(total * ethUsd)}`}</tspan>}
                          {cl.items.length > 1 && <tspan fill={col} fontSize="12">{`  ·  ${cl.items.length} crossings`}</tspan>}
                        </text>
                        <text x={plateX + 26} y={plateY + 37} fontSize="11" fontWeight="600" fill={anyReady ? "#ff8fa3" : "#94a3b8"} letterSpacing="0.04em">
                          {line2}
                        </text>
                      </g>
                    </g>
                  );
                });
              })()}
              {packets.length > 6 && (
                <text x={r.pts[0][0] + 30} y={r.pts[0][1] + 4} fontSize="11" fill="#64748b">
                  +{packets.length - 6} more
                </text>
              )}
            </g>
          );
        })}
        {/* the burner gate: the little prism, warm and waiting */}
        <circle cx={928} cy={100} r={30} fill={C.red} opacity="0.1" filter="url(#mmm-soft-convoy)" />
        <g style={{ animation: open.some((w) => w.status === "executable") ? "prism-burnglow 2.2s ease-in-out infinite" : undefined }}>
          <polygon points="928,74 900,126 956,126" fill="rgba(255,94,0,0.12)" stroke="url(#convoy-burner-edge)" strokeWidth="1.8" strokeLinejoin="round" />
          <line x1="902" y1="131" x2="954" y2="131" stroke="url(#mmm-caustic-convoy)" strokeWidth="2.2" strokeLinecap="round" opacity="0.9" />
        </g>
        <text x={928} y={150} textAnchor="middle" fontSize="12" fontWeight="700" fill="#cbd5e1">
          the burner
        </text>
        {open.length === 0 && (
          <text x={W / 2} y={H / 2 + 4} textAnchor="middle" fontSize="14" fill="#64748b">
            Nothing crossing. A flush opens a ~7-day voyage to the burner.
          </text>
        )}
      </svg>
    </section>
  );
}

// ── THE CRANK BOARD — ranked by value pushed, never by count ─────────────────
// Ranking by count would reward dust-cranking, the exact dynamic the no-bounty
// rule exists to prevent — paid in status instead of ETH. Value makes waiting
// for a fat batch the winning move. The data source is the chain itself:
// BurnBridgedToL1 records every flush cranker "for the crank board".
function CrankBoard({ board, ethUsd }: { board: BoardRow[]; ethUsd: number }) {
  return (
    <div className="rounded-2xl p-6" style={{ ...glass, borderTop: `2px solid ${C.cyan}80` }}>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">The crank board</h2>
        <span
          className="text-[10px] text-slate-600"
          title="No crank pays a bounty, by design: a paid flush would make dust-cranking profitable and turn the threshold into the batch size. The board is the reward, and it counts value, so patience wins."
        >
          ranked by value · never by count
        </span>
      </div>
      {board.length === 0 ? (
        <p className="mt-4 text-xs text-slate-600">
          Nobody has cranked yet. The first name on this board is whoever pushes the next stage.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {board.slice(0, 8).map((r, i) => {
            const what = [
              r.flushes > 0 ? `${r.flushes} flush${r.flushes === 1 ? "" : "es"}` : "",
              r.finalizes > 0 ? `${r.finalizes} finalize${r.finalizes === 1 ? "" : "s"}` : "",
              r.burns > 0 ? `${r.burns} burn${r.burns === 1 ? "" : "s"}` : "",
            ]
              .filter(Boolean)
              .join(" · ");
            // the podium wears its metals; everyone below runs in slate
            const medal = i === 0 ? "#FACC15" : i === 1 ? "#cbd5e1" : i === 2 ? "#d97706" : null;
            return (
              <a
                key={r.address}
                href={addrUrl(r.address, "ethereum")}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-all hover:brightness-125"
                style={{
                  borderColor: medal ? `${medal}33` : "rgba(255,255,255,0.05)",
                  background: medal ? `${medal}0a` : "rgba(255,255,255,0.02)",
                }}
              >
                <span
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-black tabular-nums"
                  style={{
                    fontFamily: MONO,
                    color: medal ?? "#64748b",
                    border: `1px solid ${medal ? `${medal}59` : "rgba(255,255,255,0.1)"}`,
                    boxShadow: medal ? `0 0 10px ${medal}40` : "none",
                  }}
                >
                  {i + 1}
                </span>
                <span className="shrink-0 text-[11px] font-semibold text-slate-300" style={{ fontFamily: MONO }}>
                  {r.address.slice(0, 6)}…{r.address.slice(-4)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[10px] text-slate-500">{what}</span>
                <span className="shrink-0 text-right">
                  <span className="block text-[13px] font-bold tabular-nums text-white" style={{ fontFamily: MONO, ...glow(C.orange) }}>
                    Ξ{fmtEth(r.valueEth)}
                  </span>
                  {ethUsd > 0 && <span className="block text-[10px] tabular-nums text-slate-500">{fmtUsdFull(r.valueEth * ethUsd)}</span>}
                </span>
                <TimeAgo ts={r.lastTs} short className="w-10 shrink-0 text-right text-[10px] text-slate-600" />
              </a>
            );
          })}
        </div>
      )}

    </div>
  );
}
