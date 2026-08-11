"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserProvider, Contract, formatEther, type Eip1193Provider } from "ethers";
import { AuthorizeModal } from "@/components/mothership/authorize-modal";
import { MothershipShell } from "@/components/mothership/shell";
import { AmbientBlooms } from "@/components/mothership/blooms";
import { HoloPrism } from "@/components/mothership/holo-prism";
import { C, RAINBOW, glass, glow } from "@/components/mothership/style";
import { HOOK_ADDRESS, HOOK_ABI, MIRROR_ADDRESS, SYNC_CANDIDATES, SYNC_MAX_PER_CALL, syncAbiFor, syncArgsFor } from "@/lib/prism/claim";
import { uniswapUrl } from "@/lib/chain/token-links";
import { PRISM_LIVE } from "@/lib/chain/constants";

// /claim — the Prism Hub. Connect a wallet, see your Prism NFTs + the fees
// streaming to them, and claim. Two claim paths, straight off the PrismHook:
// claimMany(tokenIds) for the per-NFT fee stream, withdrawPending() for the
// address-level accrual. The header shows the live whole/dust/pool/burned split
// of the 5,000 cap as an interactive rainbow bar (/api/prism/claim-stats).
// Wallet data is read SERVER-SIDE (/api/prism/wallet/[address]) — wallet RPCs
// choke on the big on-chain-SVG tokenURI payloads, so the connected wallet is
// used only to connect and sign. Wallets are discovered via EIP-6963 (MetaMask,
// Rabby, and any other installed extension announce themselves), with
// window.ethereum as the fallback — that fallback is also what makes the page
// work inside mobile wallets' in-app browsers.

const MONO = '"SF Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const MAINNET_HEX = "0x1";

// the Mothership's primary action (home CTA language) — inline because
// Tailwind v4 tree-shakes custom classes out of globals.css
const btnPrimary: React.CSSProperties = {
  background: `linear-gradient(90deg, ${C.purple}, ${C.cyan})`,
  boxShadow: `0 0 20px ${C.purple}4d`,
};
const BTN_PRIMARY = "rounded-xl px-6 py-3 text-sm font-semibold text-white transition-all duration-300 hover:brightness-110 disabled:opacity-50";

// ── EIP-6963 wallet discovery ─────────────────────────────────────────────────
interface WalletOption {
  info: { uuid: string; name: string; icon: string; rdns?: string };
  provider: Eip1193Provider & {
    on?: (ev: string, cb: (...a: never[]) => void) => void;
    removeListener?: (ev: string, cb: (...a: never[]) => void) => void;
    request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  };
}

function useWalletDiscovery(): WalletOption[] {
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  useEffect(() => {
    const found = new Map<string, WalletOption>();
    const onAnnounce = (e: Event) => {
      const d = (e as CustomEvent).detail as WalletOption;
      if (d?.info?.uuid && d?.provider) {
        found.set(d.info.uuid, d);
        setWallets([...found.values()]);
      }
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    // fallback: a lone injected provider that never announces (older wallets,
    // and most wallets' mobile in-app browsers)
    const t = setTimeout(() => {
      const eth = (window as unknown as { ethereum?: WalletOption["provider"] }).ethereum;
      if (eth && found.size === 0) {
        found.set("injected", { info: { uuid: "injected", name: "Browser wallet", icon: "" }, provider: eth });
        setWallets([...found.values()]);
      }
    }, 400);
    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      clearTimeout(t);
    };
  }, []);
  return wallets;
}

// ── on-chain shapes ───────────────────────────────────────────────────────────
interface OwnedToken {
  id: bigint;
  name: string;
  image?: string;
  owedETH: bigint;
  owedPRISM: bigint;
}
interface UserState {
  balance: bigint; // PRISM (18d)
  tokens: OwnedToken[];
  pendingETH: bigint; // address-level accrual
  pendingPRISM: bigint;
  lifetimeClaimedETH: bigint; // Σ Claimed events, all-time
  lifetimeClaimedPRISM: bigint;
  ens: string | null;
}
interface ClaimStats {
  cap: number;
  burned: number;
  pool: number;
  whole: number | null;
  dust: number | null;
  holders: number | null;
}
interface Overview {
  perPrism: { lifetimeETH: string; lifetimePRISM: string; eth24h: string | null };
  burned: { total: number; today: number; lastTs: number | null };
  bigBurn: { pendingEth: number; nextTs: number | null };
  recentBurns: { ts: number; prism: number; eth: number; txHash: string; chain: string }[];
  ethUsd: number;
  prismUsd: number;
}
interface InspectResult {
  id: string;
  exists: boolean;
  owner?: string;
  ownerEns?: string;
  name?: string;
  image?: string;
  owedETH?: string;
  owedPRISM?: string;
}

function agoShort(ts: number, now: number): string {
  const m = Math.max(0, Math.round((now - ts) / 60_000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// Popular wallets always offered in the connect popup — EIP-6963 can only
// discover what's installed, so the rest link to their install page. Matched
// against discovered wallets by rdns (exact) or name (substring).
const POPULAR_WALLETS = [
  { name: "MetaMask", rdns: "io.metamask", match: "metamask", url: "https://metamask.io/download/", tint: "rgba(246,133,27,0.25)" },
  { name: "Rabby", rdns: "io.rabby", match: "rabby", url: "https://rabby.io/", tint: "rgba(112,132,255,0.25)" },
  { name: "Coinbase Wallet", rdns: "com.coinbase.wallet", match: "coinbase", url: "https://www.coinbase.com/wallet", tint: "rgba(0,82,255,0.25)" },
  { name: "Brave Wallet", rdns: "com.brave.wallet", match: "brave", url: "https://brave.com/wallet/", tint: "rgba(255,80,40,0.25)" },
  { name: "Trust Wallet", rdns: "com.trustwallet.app", match: "trust", url: "https://trustwallet.com/", tint: "rgba(51,117,187,0.25)" },
];

const fmtEth = (wei: bigint, dp = 6) => {
  const n = Number(formatEther(wei));
  return n === 0 ? "0" : n < 1 / 10 ** dp ? `<${(1 / 10 ** dp).toFixed(dp)}` : n.toLocaleString("en-US", { maximumFractionDigits: dp });
};
const fmtPrism = (wei: bigint, dp = 4) => fmtEth(wei, dp);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const UNISWAP_PRISM = uniswapUrl(); // null until the new PRISM token is wired (env)
// $-equivalent of an (ETH wei, PRISM wei) pair at spot — the tangible number
const usdOf = (ethWei: bigint, prismWei: bigint, o: Overview | null): string | null => {
  if (!o || (!o.ethUsd && !o.prismUsd)) return null;
  const v = Number(formatEther(ethWei)) * (o.ethUsd || 0) + Number(formatEther(prismWei)) * (o.prismUsd || 0);
  if (!isFinite(v) || v === 0) return null;
  return v >= 100 ? `$${Math.round(v).toLocaleString("en-US")}` : v >= 0.01 ? `$${v.toFixed(2)}` : "<$0.01";
};

export default function ClaimPage() {
  const wallets = useWalletDiscovery();
  const [wallet, setWallet] = useState<WalletOption | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [chainOk, setChainOk] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [user, setUser] = useState<UserState | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [stats, setStats] = useState<ClaimStats | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tx, setTx] = useState<{ kind: "claim" | "withdraw"; phase: "wallet" | "mining" | "done"; hash?: string } | null>(null);
  const [txErr, setTxErr] = useState<string | null>(null);
  // both consequential actions go through the hold-to-execute AUTHORIZE sheet
  const [authorize, setAuthorize] = useState<null | "claim" | "withdraw">(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [nowTs] = useState(() => Date.now()); // mount-time "now" for the ago-labels
  const [inspectQuery, setInspectQuery] = useState("");
  const [inspectRes, setInspectRes] = useState<InspectResult | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [gridShown, setGridShown] = useState(24); // whale wallets: render 24 Prisms at a time
  // resync (whole PRISM ⇄ fee-share NFTs) — see the `resync` callback below
  const [syncState, setSyncState] = useState<"idle" | "probing" | "wallet" | "mining" | "done" | "more" | "unsupported">("idle");
  const [celebrate, setCelebrate] = useState<{ e: bigint; p: bigint } | null>(null);
  const [shareState, setShareState] = useState<"idle" | "rendering" | "copied" | "downloaded">("idle");
  const shareRef = useRef<HTMLDivElement>(null);
  const reloadSeq = useRef(0);
  const busyRef = useRef(false); // pause the auto-refresh while a tx is in flight

  // close the wallet popup on Escape
  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPickerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickerOpen]);

  // header stats + overview — public, no wallet needed
  useEffect(() => {
    fetch("/api/prism/claim-stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && !j.error && setStats(j))
      .catch(() => {});
    fetch("/api/prism/overview")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && !j.error && setOverview(j))
      .catch(() => {});
  }, []);

  const inspect = useCallback(async () => {
    const id = inspectQuery.trim().replace(/^#/, "");
    if (!/^\d{1,10}$/.test(id)) return;
    setInspecting(true);
    setInspectRes(null);
    try {
      const r = await fetch(`/api/prism/token/${id}`);
      const j = await r.json();
      if (r.ok && !j.error) setInspectRes(j);
      else setInspectRes({ id, exists: false });
    } catch {
      setInspectRes({ id, exists: false });
    } finally {
      setInspecting(false);
    }
  }, [inspectQuery]);

  const connect = useCallback(async (w: WalletOption) => {
    setConnecting(w.info.uuid);
    setTxErr(null);
    try {
      const accs = (await w.provider.request({ method: "eth_requestAccounts" })) as string[];
      if (!accs?.length) return;
      const chain = (await w.provider.request({ method: "eth_chainId" })) as string;
      setWallet(w);
      setAccount(accs[0]);
      setChainOk(chain === MAINNET_HEX);
      setPickerOpen(false); // connected — the options popup has done its job
    } catch {
      /* user rejected */
    } finally {
      setConnecting(null);
    }
  }, []);

  // track account / chain changes on the connected wallet
  useEffect(() => {
    if (!wallet?.provider.on) return;
    const onAccounts = (accs: string[]) => setAccount(accs?.[0] ?? null);
    const onChain = (id: string) => setChainOk(id === MAINNET_HEX);
    wallet.provider.on("accountsChanged", onAccounts as never);
    wallet.provider.on("chainChanged", onChain as never);
    return () => {
      wallet.provider.removeListener?.("accountsChanged", onAccounts as never);
      wallet.provider.removeListener?.("chainChanged", onChain as never);
    };
  }, [wallet]);

  const switchToMainnet = useCallback(async () => {
    try {
      await wallet?.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: MAINNET_HEX }] });
    } catch {
      /* wallet refused */
    }
  }, [wallet]);

  // load everything for the connected account — server-side read (the wallet's
  // own RPC can't return the big SVG tokenURI payloads reliably)
  const loadUser = useCallback(
    async (fresh = false) => {
      if (!account || !chainOk) return;
      const seq = ++reloadSeq.current;
      setLoading(true);
      setLoadErr(null);
      try {
        const r = await fetch(`/api/prism/wallet/${account}${fresh ? "?fresh=1" : ""}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`wallet read failed (${r.status})`);
        const j = (await r.json()) as {
          balance: string;
          pendingETH: string;
          pendingPRISM: string;
          lifetimeClaimedETH?: string;
          lifetimeClaimedPRISM?: string;
          tokens: { id: string; name: string; image?: string; owedETH: string; owedPRISM: string }[];
        };
        const tokens: OwnedToken[] = j.tokens.map((t) => ({
          id: BigInt(t.id),
          name: t.name,
          image: t.image,
          owedETH: BigInt(t.owedETH),
          owedPRISM: BigInt(t.owedPRISM),
        }));
        if (seq !== reloadSeq.current) return; // superseded by a newer reload
        setUser({
          balance: BigInt(j.balance),
          tokens,
          pendingETH: BigInt(j.pendingETH),
          pendingPRISM: BigInt(j.pendingPRISM),
          lifetimeClaimedETH: BigInt(j.lifetimeClaimedETH ?? "0"),
          lifetimeClaimedPRISM: BigInt(j.lifetimeClaimedPRISM ?? "0"),
          ens: (j as { ens?: string | null }).ens ?? null,
        });
        setSelected(new Set(tokens.filter((t) => t.owedETH > 0n || t.owedPRISM > 0n).map((t) => t.id.toString())));
      } catch (e) {
        if (seq === reloadSeq.current) setLoadErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (seq === reloadSeq.current) setLoading(false);
      }
    },
    [account, chainOk],
  );

  useEffect(() => {
    setUser(null);
    setGridShown(24);
    if (account && chainOk) loadUser();
  }, [account, chainOk, loadUser]);

  // fees accrue continuously — refresh the numbers every 60s while connected
  useEffect(() => {
    if (!account || !chainOk) return;
    const t = setInterval(() => {
      if (!document.hidden && !busyRef.current) loadUser();
    }, 60_000);
    return () => clearInterval(t);
  }, [account, chainOk, loadUser]);

  // ── writes ──────────────────────────────────────────────────────────────────
  const runTx = useCallback(
    async (kind: "claim" | "withdraw") => {
      if (!wallet || !account) return;
      setTxErr(null);
      setTx({ kind, phase: "wallet" });
      try {
        const provider = new BrowserProvider(wallet.provider);
        const signer = await provider.getSigner();
        const hook = new Contract(HOOK_ADDRESS, HOOK_ABI, signer);
        const resp =
          kind === "claim"
            ? await hook.claimMany(user!.tokens.filter((t) => selected.has(t.id.toString())).map((t) => t.id))
            : await hook.withdrawPending();
        setTx({ kind, phase: "mining", hash: resp.hash });
        await resp.wait();
        setTx({ kind, phase: "done", hash: resp.hash });
        // Celebrate when money actually reaches the wallet — that is the withdraw,
        // not the claim. claimMany only REALIZES fees into the address-level bucket
        // (verified on-chain: a user ran claimMany twice, Claimed events fired, and
        // zero ETH ever moved to their wallet — the payout is withdrawPending()).
        // Celebrating at claim taught users they were done one step early.
        if (kind === "withdraw") {
          setCelebrate({ e: user?.pendingETH ?? 0n, p: user?.pendingPRISM ?? 0n });
          setTimeout(() => setCelebrate(null), 3200);
        }
        loadUser(true); // bypass the server cache so the claim shows immediately
      } catch (e) {
        setTx(null);
        const msg = e instanceof Error ? e.message : String(e);
        setTxErr(/user rejected|denied/i.test(msg) ? null : msg.slice(0, 200));
      }
    },
    [wallet, account, user, selected, loadUser],
  );

  // ── resync: rebuild this wallet's fee-share NFTs from its whole-PRISM balance
  // The mirror mints one NFT per whole token; after transfers that set can lag,
  // and fees only stream to NFTs you actually hold — so a holder can be earning
  // on fewer shares than they own. This pokes the contract to catch it up.
  //
  // The function name isn't known until the community's token ships, so we probe
  // the candidates (see SYNC_CANDIDATES) with a static call and send the first
  // the contract accepts, on the token then the mirror. Nothing is guessed on
  // chain: a candidate that doesn't exist reverts the simulation and is skipped.
  const resync = useCallback(async () => {
    if (!wallet || !account) return;
    setTxErr(null);
    setSyncState("probing");
    try {
      const provider = new BrowserProvider(wallet.provider);
      const signer = await provider.getSigner();

      let found: { target: string; sig: string } | null = null;
      for (const target of [HOOK_ADDRESS, MIRROR_ADDRESS].filter((a) => /^0x[a-fA-F0-9]{40}$/.test(a))) {
        for (const sig of SYNC_CANDIDATES) {
          const c = new Contract(target, syncAbiFor(sig), signer);
          const name = sig.slice(0, sig.indexOf("("));
          try {
            await c[name].staticCall(...syncArgsFor(sig, account)); // exists + wouldn't revert
            found = { target, sig };
            break;
          } catch {
            /* not this one — keep probing */
          }
        }
        if (found) break;
      }

      if (!found) {
        setSyncState("unsupported");
        return;
      }

      setSyncState("wallet");
      const c = new Contract(found.target, syncAbiFor(found.sig), signer);
      const name = found.sig.slice(0, found.sig.indexOf("("));
      const resp = await c[name](...syncArgsFor(found.sig, account));
      setSyncState("mining");
      await resp.wait();
      // v2 caps mints per call (MAX_REALIGN = SYNC_MAX_PER_CALL), so one
      // transaction cannot finish a holder whose NFT count is further behind than
      // the cap. That's known from state we already hold, so say "run it again"
      // instead of claiming "synced".
      const behind = user ? Number(user.balance / 10n ** 18n) - user.tokens.length : 0;
      const needsMore = behind > SYNC_MAX_PER_CALL;
      loadUser(true); // pull the rebuilt NFT set
      setSyncState(needsMore ? "more" : "done");
      setTimeout(() => setSyncState("idle"), needsMore ? 9000 : 4000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSyncState("idle");
      setTxErr(/user rejected|denied/i.test(msg) ? null : msg.slice(0, 200));
    }
  }, [wallet, account, user, loadUser]);

  // Render the share card off-screen and copy it (download fallback). Reuses the
  // Studio's modern-screenshot path — html2canvas dies on Tailwind v4 CSS.
  const shareCard = useCallback(async () => {
    if (!user || shareState === "rendering") return;
    setShareState("rendering");
    try {
      const node = shareRef.current;
      if (!node) throw new Error("no node");
      const imgs = Array.from(node.querySelectorAll("img"));
      await Promise.all(
        imgs.map((img) =>
          img.complete && img.naturalWidth
            ? Promise.resolve()
            : new Promise<void>((res) => {
                img.addEventListener("load", () => res(), { once: true });
                img.addEventListener("error", () => res(), { once: true });
                setTimeout(res, 3000);
              }),
        ),
      );
      if (document.fonts?.ready) await document.fonts.ready;
      const { domToCanvas } = await import("modern-screenshot");
      const canvas = await domToCanvas(node, { scale: 2 });
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
      if (!blob) throw new Error("no blob");
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        setShareState("copied");
      } else {
        const a = document.createElement("a");
        a.download = "my-prism.png";
        a.href = URL.createObjectURL(blob);
        a.click();
        URL.revokeObjectURL(a.href);
        setShareState("downloaded");
      }
    } catch {
      setShareState("idle");
      return;
    }
    setTimeout(() => setShareState("idle"), 2200);
  }, [user, shareState]);

  // ── derived ─────────────────────────────────────────────────────────────────
  const selectedTotals = useMemo(() => {
    let e = 0n, p = 0n;
    for (const t of user?.tokens ?? []) if (selected.has(t.id.toString())) { e += t.owedETH; p += t.owedPRISM; }
    return { e, p };
  }, [user, selected]);
  // total accrued across ALL owned Prisms — the headline numbers above the grid
  const allTotals = useMemo(() => {
    let e = 0n, p = 0n;
    for (const t of user?.tokens ?? []) { e += t.owedETH; p += t.owedPRISM; }
    return { e, p };
  }, [user]);
  const withFees = useMemo(() => (user?.tokens ?? []).filter((t) => t.owedETH > 0n || t.owedPRISM > 0n), [user]);
  const allSelected = withFees.length > 0 && withFees.every((t) => selected.has(t.id.toString())) && selected.size <= (user?.tokens.length ?? 0);
  // "Whole" is a property of the BALANCE, not of the NFT set: the mirror mints at
  // most MAX_REALIGN (128) NFTs per transfer, so a large buy leaves whole tokens
  // without their NFT until a resync. Deriving whole from tokens.length mislabelled
  // exactly that state — a 129.94-PRISM wallet read "128 whole · 1.94 dust", and the
  // dust card told them to buy more when the fix was one resync press.
  const nftCount = user?.tokens.length ?? 0;
  const wholeOwned = user ? Number(user.balance / 10n ** 18n) : 0;
  const dustOwned = user ? Math.max(0, Number(formatEther(user.balance)) - wholeOwned) : 0;
  const unsynced = Math.max(0, wholeOwned - nftCount);
  const hasWithdraw = (user?.pendingETH ?? 0n) > 0n || (user?.pendingPRISM ?? 0n) > 0n;
  const busy = tx != null && tx.phase !== "done";
  busyRef.current = busy;

  return (
    <MothershipShell>
      <AmbientBlooms />

      <main className="container mx-auto px-4 md:px-6 max-w-[1100px] py-8 md:py-12 relative z-10">
        {/* ── hero: connect-first, with the prism in a wallet (the designer rework).
            Left = title + the connect action right at the top; right = the
            wallet scene: a glass wallet with the holo prism tucked in its
            pocket, fees pulsing in, the Dead-PRISM chip floating beside. ── */}
        <div className="grid grid-cols-1 items-center gap-x-8 gap-y-10 lg:grid-cols-2">
          <div className="min-w-0 text-center lg:text-left">
            <div
              className="mb-4 inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em]"
              style={{ borderColor: `${C.green}33`, background: `${C.green}14`, color: C.green }}
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: C.green }} />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: C.green }} />
              </span>
              The Prism Hub
            </div>
            <h1 className="text-4xl font-black tracking-tight text-white sm:text-6xl">
              Your fees
              <br /> live here.
            </h1>
            <p className="mx-auto mt-3 max-w-[480px] text-[15px] leading-relaxed text-slate-400 lg:mx-0">
              Every whole PRISM is a Prism NFT with pool fees streaming to it.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-4 lg:justify-start">
              {!account ? (
                <>
                  <button onClick={() => setPickerOpen(true)} className={`${BTN_PRIMARY} !px-8 !py-4 !text-base`} style={btnPrimary}>
                    Connect wallet
                  </button>
                  <span className="text-[12px] text-slate-500">Read-only. Connecting never signs anything.</span>
                </>
              ) : (
                <div
                  className="inline-flex flex-wrap items-center gap-3 rounded-xl border border-white/10 px-4 py-3 text-sm text-slate-200"
                  style={{ background: "rgba(3,4,9,0.5)", fontFamily: MONO }}
                >
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: C.green }} />
                    <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: C.green }} />
                  </span>
                  {short(account)}
                  {user && (
                    <span style={{ color: C.green }}>
                      {user.tokens.length} Prism{user.tokens.length === 1 ? "" : "s"} aboard
                    </span>
                  )}
                  {!chainOk && (
                    <button onClick={switchToMainnet} className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-amber-300 hover:bg-amber-400/20">
                      Switch to mainnet
                    </button>
                  )}
                  <button
                    onClick={() => { setWallet(null); setAccount(null); setUser(null); setTx(null); }}
                    className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-slate-400 hover:text-white hover:border-white/25"
                    title="Disconnect"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* the wallet scene */}
          <div className="relative mx-auto h-[300px] w-full max-w-[420px]">
            <div
              className="pointer-events-none absolute left-1/2 top-1/2 h-[240px] w-[240px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed"
              style={{ borderColor: `${C.green}26`, animation: "spin 22s linear infinite" }}
            />
            {/* fee sparks drifting toward the wallet */}
            {[
              { l: "12%", t: "30%", d: "0s" },
              { l: "82%", t: "62%", d: "0.7s" },
              { l: "20%", t: "72%", d: "1.3s" },
            ].map((s, i) => (
              <span
                key={i}
                aria-hidden
                className="absolute h-1.5 w-1.5 rounded-full"
                style={{ left: s.l, top: s.t, background: C.green, boxShadow: `0 0 10px ${C.green}`, animation: `live-pulse 2.2s ${s.d} infinite` }}
              />
            ))}
            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{ animation: "ms-float 6s ease-in-out infinite" }}
            >
              <div className="relative flex flex-col items-center">
                {/* the prism, tucked: its base slides behind the wallet face */}
                <div className="relative z-0 -mb-14" style={{ filter: `drop-shadow(0 18px 30px rgba(0,0,0,0.6)) drop-shadow(0 0 34px ${C.green}33)` }}>
                  <HoloPrism size={140} spinSec={9} />
                </div>
                {/* the wallet face */}
                <div
                  className="relative z-10 h-[104px] w-[260px] overflow-hidden rounded-2xl border border-white/15"
                  style={{
                    background: "linear-gradient(160deg, rgba(26,30,44,0.98) 0%, rgba(8,10,16,0.98) 70%)",
                    boxShadow: `0 24px 50px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.12), 0 0 34px ${C.green}14`,
                  }}
                >
                  <div className="absolute left-0 top-0 h-[2px] w-full" style={{ background: RAINBOW, opacity: 0.75 }} />
                  {/* the pocket seam */}
                  <div className="absolute inset-x-4 top-3 h-px bg-white/10" aria-hidden />
                  <div className="flex h-full flex-col justify-end p-4">
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <div className="text-[9px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                          {account ? "Connected wallet" : "Prism wallet"}
                        </div>
                        <div className="mt-1 text-[13px] font-bold text-white" style={{ fontFamily: MONO }}>
                          {account ? short(account) : "0x · · · · · · · ·"}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[9px] font-semibold uppercase tracking-[0.22em] text-slate-500">Prisms</div>
                        <div className="mt-1 text-[15px] font-bold tabular-nums" style={{ fontFamily: MONO, color: C.green, ...glow(C.green) }}>
                          {account && user ? user.tokens.length : "—"}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            {/* Dead PRISM docks at the scene's corner */}
            {overview && (
              <div
                className="absolute -top-1 right-0 rounded-2xl px-3 py-2.5 text-right"
                style={{ ...glass, borderTop: `2px solid ${C.orange}80`, background: "rgba(3,4,9,0.7)" }}
                title="PRISM bought back and burned forever"
              >
                <div className="text-[10px] uppercase tracking-[0.18em] font-semibold" style={{ color: C.orange }}>Dead PRISM</div>
                <div className="mt-1 text-[20px] font-bold text-white tabular-nums leading-none" style={{ fontFamily: MONO, ...glow(C.orange) }}>
                  {overview.burned.total.toFixed(2)}
                </div>
                <div className="mt-1.5 text-[10px] text-slate-500" style={{ fontFamily: MONO }}>
                  {overview.burned.lastTs ? `last burn ${agoShort(overview.burned.lastTs, nowTs)}` : "of 5,000 · forever"}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* !overflow-visible + z-30: the hover tooltips must escape the card (glass-card
            clips by default) and paint above every card below it */}
        <div className="flex flex-col">
        <div className="order-1 mt-6 rounded-2xl p-5 !overflow-visible" style={{ ...glass, zIndex: 30, position: "relative" }}>
          <div className="absolute left-0 top-0 h-[2px] w-full rounded-t-2xl" style={{ background: RAINBOW, opacity: 0.8 }} />
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-xl font-bold tracking-tight text-white sm:text-2xl">
              The{" "}
              <span
                style={{
                  backgroundImage: "linear-gradient(90deg,#ff5a5a,#ff9f1c,#ffe14d,#5cff8f,#3bd9ff,#6a8bff,#c06aff,#ff5a5a)",
                  backgroundSize: "220% 100%",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  color: "transparent",
                  WebkitTextFillColor: "transparent",
                  animation: "prism-bar-pan 8s linear infinite",
                  filter: "drop-shadow(0 0 14px rgba(140,120,255,0.35))",
                }}
              >
                5000
              </span>{" "}
              Prism breakdown
            </span>
            {stats?.holders != null && (
              <span className="text-[12px] text-slate-500" style={{ fontFamily: MONO }}>{stats.holders} wallets hold whole Prisms</span>
            )}
          </div>
          {stats ? (
            <RainbowBar stats={stats} />
          ) : (
            <div className="mt-4 text-[13px] text-slate-500" style={{ fontFamily: MONO }}>reading the chain…</div>
          )}
        </div>

        {/* ── overview trio: per-Prism earnings · next big burn · recent burns ──
            compact cards; each links out to the page that carries the full data */}
        {overview && (
          <div className="order-3 mt-5 grid grid-cols-1 md:grid-cols-3 gap-5 lg:order-2">
            <div className="rounded-2xl px-3.5 py-2.5 flex flex-col" style={{ ...glass, borderTop: `2px solid ${C.green}80` }}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] uppercase tracking-[0.2em] text-slate-400 font-semibold">One Prism has earned</span>
                <a href="/charts" className="text-[11px] font-semibold text-cyan-300 hover:text-cyan-200 shrink-0">Charts →</a>
              </div>
              <div className="mt-1.5 flex items-baseline gap-2 flex-wrap">
                <span className="text-[17px] font-bold text-white tabular-nums leading-none" style={{ fontFamily: MONO }}>
                  Ξ{fmtEth(BigInt(overview.perPrism.lifetimeETH), 4)}
                </span>
                <span className="text-[13px] text-slate-300 tabular-nums" style={{ fontFamily: MONO }}>
                  + {fmtPrism(BigInt(overview.perPrism.lifetimePRISM), 2)} PRISM
                </span>
              </div>
              {/* the hook's own accFeesPerShare accumulators — a Prism held since
                  day one earned exactly this; later mints earned less (verified
                  2026-08-03 on the designer's is-this-right question) */}
              {usdOf(BigInt(overview.perPrism.lifetimeETH), BigInt(overview.perPrism.lifetimePRISM), overview) && (
                <p className="mt-1 text-[10px] text-slate-500" style={{ fontFamily: MONO }}>
                  ≈ {usdOf(BigInt(overview.perPrism.lifetimeETH), BigInt(overview.perPrism.lifetimePRISM), overview)} per Prism held since day one
                </p>
              )}
            </div>

            {/* last burn — click opens the activity bento popup on /spectrum */}
            <a
              href={
                overview.recentBurns[0]
                  ? `/spectrum?tx=${overview.recentBurns[0].txHash}${overview.recentBurns[0].chain === "base" ? "&c=b" : ""}`
                  : "/spectrum"
              }
              className="rounded-2xl px-3.5 py-2.5 flex flex-col transition-transform hover:-translate-y-0.5"
              style={{ ...glass, borderTop: `2px solid ${C.orange}80` }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] uppercase tracking-[0.2em] text-slate-400 font-semibold">🔥 Last burn</span>
                <span className="text-[11px] font-semibold text-cyan-300 shrink-0">Details →</span>
              </div>
              {overview.recentBurns[0] ? (
                <>
                  <div className="mt-1.5 flex items-baseline gap-2 flex-wrap">
                    <span className="text-[17px] font-bold text-white tabular-nums leading-none" style={{ fontFamily: MONO }}>
                      {overview.recentBurns[0].prism > 0.0005 ? `${overview.recentBurns[0].prism.toFixed(3)} PRISM` : `Ξ${overview.recentBurns[0].eth.toFixed(4)}`}
                    </span>
                    <span className="text-[12px] text-slate-400" style={{ fontFamily: MONO }}>{agoShort(overview.recentBurns[0].ts, nowTs)}</span>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">bought &amp; burned, gone from the 5,000</p>
                </>
              ) : (
                <div className="mt-2 text-[15px] font-semibold text-slate-300 leading-none">No burns yet</div>
              )}
            </a>

            <div className="rounded-2xl px-3.5 py-2.5 flex flex-col" style={{ ...glass, borderTop: `2px solid ${C.purple}80` }}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] uppercase tracking-[0.2em] text-slate-400 font-semibold">Recent burns</span>
                <a href="/charts" className="text-[11px] font-semibold text-cyan-300 hover:text-cyan-200 shrink-0">Charts →</a>
              </div>
              {overview.recentBurns.length ? (
                <div className="mt-1.5 flex flex-col gap-0">
                  {overview.recentBurns.slice(0, 3).map((b) => (
                    <a
                      key={b.txHash}
                      href={`https://${b.chain === "base" ? "basescan.org" : "etherscan.io"}/tx/${b.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between gap-2 rounded-md px-1.5 py-0.5 -mx-1.5 text-[11px] transition-colors hover:bg-white/[0.05]"
                      style={{ fontFamily: MONO }}
                    >
                      <span className="text-white tabular-nums">🔥 {b.prism > 0.0005 ? `${b.prism.toFixed(3)} PRISM` : `Ξ${b.eth.toFixed(4)}`}</span>
                      <span className="text-slate-500 text-[11px] shrink-0">{agoShort(b.ts, nowTs)} ↗</span>
                    </a>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[12px] text-slate-500">none in the recent window</p>
              )}
            </div>
          </div>
        )}

        {/* ── Prism inspector — a single tiny row ── */}
        <div className="order-4 mt-5 rounded-2xl px-3.5 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 lg:order-3" style={glass}>
          <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-semibold shrink-0">Look up a Prism</span>
          <form
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              inspect();
            }}
          >
            <input
              value={inspectQuery}
              onChange={(e) => setInspectQuery(e.target.value)}
              placeholder="#43943"
              inputMode="numeric"
              className="w-[86px] rounded-md bg-black/40 border border-white/10 px-2 py-1 text-[12px] text-white outline-none focus:border-white/30"
              style={{ fontFamily: MONO }}
            />
            <button type="submit" disabled={inspecting || !/^#?\d{1,10}$/.test(inspectQuery.trim())} className="rounded-md border border-white/10 px-2.5 py-1 text-[12px] text-slate-300 hover:text-white hover:border-white/25 disabled:opacity-40">
              {inspecting ? "…" : "Go"}
            </button>
          </form>
          {inspectRes &&
            (inspectRes.exists ? (
              <span className="flex items-center gap-2.5 min-w-0 text-[12px]" style={{ fontFamily: MONO }}>
                {inspectRes.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={inspectRes.image} alt="" className="h-7 w-7 rounded-md bg-black/40 shrink-0" />
                )}
                <span className="text-white font-semibold shrink-0">{inspectRes.name}</span>
                <a href={`https://etherscan.io/address/${inspectRes.owner}`} target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-white shrink-0">
                  {inspectRes.ownerEns || short(inspectRes.owner!)}
                </a>
                <span className="text-slate-400 tabular-nums truncate">owed Ξ{fmtEth(BigInt(inspectRes.owedETH ?? "0"))} + {fmtPrism(BigInt(inspectRes.owedPRISM ?? "0"))}</span>
              </span>
            ) : (
              <span className="text-[12px] text-slate-500">Prism #{inspectRes.id} doesn&apos;t exist</span>
            ))}
        </div>

        {/* ── your prisms + claims ── */}
        {account && chainOk && (
          <div className="order-5">
            {loading && <div className="py-14 text-center text-slate-500" style={{ fontFamily: MONO }}>reading your Prism on-chain…</div>}
            {loadErr && !loading && (
              <div className="mt-5 rounded-2xl p-4 text-[13px] text-red-300" style={glass}>
                Couldn&apos;t read your wallet&apos;s Prism. <button onClick={() => loadUser()} className="underline underline-offset-2">Retry</button>
              </div>
            )}

            {user && !loading && (
              <>
                {user.tokens.length > 0 ? (
                  <div className="mt-5 rounded-2xl p-5" style={glass}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="text-[11px] uppercase tracking-[0.2em] text-slate-400 font-semibold">
                        Your Prisms · {user.tokens.length}
                      </span>
                      <div className="flex items-center gap-3 text-[12px]" style={{ fontFamily: MONO }}>
                        <button
                          onClick={() => setSelected(new Set(user.tokens.map((t) => t.id.toString())))}
                          className="text-slate-400 hover:text-white"
                        >
                          select all
                        </button>
                        <button onClick={() => setSelected(new Set())} className="text-slate-400 hover:text-white">
                          none
                        </button>
                        <span className="h-3 w-px bg-white/15" aria-hidden />
                        {/* resync: rebuild the fee-share NFTs from the wallet's whole-PRISM balance */}
                        <button
                          onClick={resync}
                          disabled={syncState === "probing" || syncState === "wallet" || syncState === "mining"}
                          title="Rebuild your fee-share NFTs from your whole PRISM balance. Fees only stream to NFTs you hold, so if the count is behind your balance, resync catches it up."
                          className="inline-flex items-center gap-1.5 text-cyan-300 hover:text-cyan-200 disabled:text-slate-500 disabled:cursor-default"
                        >
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden
                            className={syncState === "probing" || syncState === "wallet" || syncState === "mining" ? "animate-spin" : ""}
                          >
                            <path d="M3 12a9 9 0 0 1 9-9c2.6 0 4.9 1.1 6.5 2.9" />
                            <path d="M21 3v5h-5" />
                            <path d="M21 12a9 9 0 0 1-9 9c-2.6 0-4.9-1.1-6.5-2.9" />
                            <path d="M3 21v-5h5" />
                          </svg>
                          {syncState === "probing"
                            ? "checking…"
                            : syncState === "wallet"
                              ? "confirm in wallet…"
                              : syncState === "mining"
                                ? "resyncing…"
                                : syncState === "done"
                                  ? "resynced ✓"
                                  : syncState === "more"
                                    ? "partly synced, run again"
                                  : syncState === "unsupported"
                                    ? "resync unavailable"
                                    : "resync NFTs"}
                        </button>
                      </div>
                    </div>

                    {/* ONE flow, one card (the designer: side-by-side steps read as two
                        products). The headline is the TOTAL — the number a holder
                        actually asks about — the pipeline underneath shows where it
                        sits, and ONE primary button always does the next right thing:
                        Claim realizes streamed fees, then the same slot becomes
                        Withdraw. Money is a sequence, so the UI is one. */}
                    {(() => {
                      const totalE = allTotals.e + user.pendingETH;
                      const totalP = allTotals.p + user.pendingPRISM;
                      const hasAccrued = allTotals.e > 0n || allTotals.p > 0n;
                      const justClaimed = tx?.kind === "claim" && tx.phase === "done";
                      const primary: "claim" | "withdraw" | null =
                        hasAccrued && !justClaimed ? "claim" : hasWithdraw ? "withdraw" : hasAccrued ? "claim" : null;
                      const stage = (label: string, e: bigint, pr: bigint, active: boolean, hint: string) => (
                        <div
                          className="rounded-xl border px-4 py-3 flex-1 min-w-[190px]"
                          style={
                            active
                              ? { borderColor: "rgba(92,255,143,0.35)", background: "rgba(92,255,143,0.05)" }
                              : { borderColor: "rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.02)" }
                          }
                        >
                          <div className="text-[10px] uppercase tracking-[0.16em] font-semibold" style={{ color: active ? "#5cff8f" : "rgba(148,163,184,0.9)" }}>
                            {label}
                          </div>
                          <div className={`mt-1 text-[15px] font-bold tabular-nums ${e > 0n || pr > 0n ? "text-white" : "text-slate-600"}`} style={{ fontFamily: MONO }}>
                            Ξ{fmtEth(e)} + {fmtPrism(pr)}
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div>
                        </div>
                      );
                      return (
                        <div className="relative mt-4 overflow-hidden rounded-2xl p-5 sm:p-6" style={{ ...glass, border: `1px solid ${C.green}33` }}>
                          {/* the deck's revenue-core language: this is the page's money center */}
                          <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(circle at 18% 30%, ${C.green}14 0%, rgba(0,0,0,0) 55%)` }} />
                          <div
                            className="pointer-events-none absolute -right-20 -top-24 h-[280px] w-[280px] rounded-full border border-dashed"
                            style={{ borderColor: `${C.green}1a`, animation: "spin 24s linear infinite" }}
                          />
                          <div className="relative z-10 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                            <div>
                              <div
                                className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]"
                                style={{ borderColor: `${C.green}33`, background: `${C.green}14`, color: C.green }}
                              >
                                Your fees
                              </div>
                              <div className="mt-2.5 flex flex-wrap items-baseline gap-x-5 gap-y-1">
                                {usdOf(totalE, totalP, overview) && (
                                  <span className="text-4xl font-black tracking-tight text-white tabular-nums sm:text-5xl" style={{ fontFamily: MONO, ...glow(C.green) }}>
                                    {usdOf(totalE, totalP, overview)}
                                  </span>
                                )}
                                <span className="text-[15px] font-semibold text-slate-300 tabular-nums" style={{ fontFamily: MONO }}>
                                  Ξ{fmtEth(totalE)} + {fmtPrism(totalP)} PRISM
                                </span>
                              </div>
                            </div>
                            {(user.lifetimeClaimedETH > 0n || user.lifetimeClaimedPRISM > 0n) && (
                              <div className="text-right">
                                {/* Fed by Claimed events, which measure REALIZATION (stage 1 → 2), not payout —
                                    this very wallet had 0.0449 "claimed" and never withdrawn. The label must
                                    match the event's meaning or the pipeline lies about its own history. */}
                                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 font-semibold">Claimed all-time</div>
                                <div className="mt-1 text-[12px] text-slate-400 tabular-nums" style={{ fontFamily: MONO }}>
                                  Ξ{fmtEth(user.lifetimeClaimedETH)} + {fmtPrism(user.lifetimeClaimedPRISM)}
                                  {usdOf(user.lifetimeClaimedETH, user.lifetimeClaimedPRISM, overview) && (
                                    <span className="ml-1.5 text-slate-500">
                                      ≈ {usdOf(user.lifetimeClaimedETH, user.lifetimeClaimedPRISM, overview)}
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="relative z-10 mt-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                            {stage("1 · Streaming", allTotals.e, allTotals.p, primary === "claim", `accruing on your ${nftCount} Prism${nftCount === 1 ? "" : "s"}`)}
                            <span className="hidden sm:block text-slate-600 shrink-0">→</span>
                            <span className="sm:hidden text-slate-600 text-center leading-none">↓</span>
                            {stage("2 · Realized", user.pendingETH, user.pendingPRISM, primary === "withdraw", "claiming lands it here")}
                            <span className="hidden sm:block text-slate-600 shrink-0">→</span>
                            <span className="sm:hidden text-slate-600 text-center leading-none">↓</span>
                            <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 flex-1 min-w-[190px]">
                              <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400 font-semibold">3 · Your wallet</div>
                              <div className="mt-1 text-[15px] font-bold text-slate-300 tabular-nums" style={{ fontFamily: MONO }}>
                                withdrawing pays out
                              </div>
                              <div className="mt-0.5 text-[11px] text-slate-500">both stages, one withdraw</div>
                            </div>
                          </div>

                          <div className="relative z-10 mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                            {primary === "claim" && (
                              <button
                                onClick={() => setAuthorize("claim")}
                                disabled={busy || selected.size === 0 || (selectedTotals.e === 0n && selectedTotals.p === 0n)}
                                className={BTN_PRIMARY}
                                style={btnPrimary}
                              >
                                {tx?.kind === "claim" && tx.phase === "wallet"
                                  ? "Confirm in wallet…"
                                  : tx?.kind === "claim" && tx.phase === "mining"
                                    ? "Claiming…"
                                    : allSelected
                                      ? "Claim all"
                                      : `Claim ${selected.size} selected`}
                              </button>
                            )}
                            {primary === "withdraw" && (
                              <button onClick={() => setAuthorize("withdraw")} disabled={busy} className={BTN_PRIMARY} style={btnPrimary}>
                                {tx?.kind === "withdraw" && tx.phase === "wallet"
                                  ? "Confirm in wallet…"
                                  : tx?.kind === "withdraw" && tx.phase === "mining"
                                    ? "Withdrawing…"
                                    : `Withdraw Ξ${fmtEth(user.pendingETH)} + ${fmtPrism(user.pendingPRISM)} to wallet`}
                              </button>
                            )}
                            {primary === null && (
                              <span className="text-[13px] text-slate-500">Nothing to claim yet. Fees stream in as the pool trades.</span>
                            )}
                            {primary === "claim" && hasWithdraw && (
                              <button onClick={() => setAuthorize("withdraw")} disabled={busy} className="text-[12px] text-slate-400 underline underline-offset-4 hover:text-white disabled:opacity-50">
                                or withdraw the realized Ξ{fmtEth(user.pendingETH)} now
                              </button>
                            )}
                            <button
                              onClick={shareCard}
                              disabled={shareState === "rendering"}
                              className="ml-auto rounded-xl px-6 py-3 text-[0.95rem] font-semibold text-white transition-all duration-150 hover:-translate-y-0.5 hover:saturate-150 disabled:opacity-60 disabled:hover:translate-y-0"
                              // The site's spectrum as a 1px gradient border over glass — quieter
                              // than the primary CTA, but the one control carrying the rainbow,
                              // which is exactly what it shares. Inline because Tailwind v4
                              // tree-shakes custom classes out of globals.css (dossier lesson:
                              // .btn-spectrum compiled to zero served rules while the source had 3).
                              style={{
                                background:
                                  "linear-gradient(rgba(13,14,22,0.92), rgba(13,14,22,0.92)) padding-box, linear-gradient(90deg,#ff5a5a,#ff9f1c,#ffe14d,#5cff8f,#3bd9ff,#6a8bff,#c06aff) border-box",
                                border: "1px solid transparent",
                                boxShadow: "0 2px 14px rgba(124,139,255,0.12)",
                              }}
                              title="Copy a share card of your Prisms"
                            >
                              {shareState === "rendering"
                                ? "Rendering…"
                                : shareState === "copied"
                                  ? "Copied ✓"
                                  : shareState === "downloaded"
                                    ? "Saved ✓"
                                    : "Share your Prisms 🔻"}
                            </button>
                          </div>
                        </div>
                      );
                    })()}


                    {/* whole PRISM without its NFT: the mirror mints ≤128 per transfer, so a
                        large buy leaves the tail unminted — and fees stream only to NFTs that
                        exist. This banner is that state's ONLY honest prompt; the dust card
                        below is about fractions and must not speak for it. */}
                    {unsynced > 0 && (
                      <div
                        className="mt-5 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4"
                        style={{ ...glass, border: "1px solid rgba(255,225,77,0.35)" }}
                      >
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.2em] font-semibold" style={{ color: "#ffe14d" }}>
                            {unsynced} Prism NFT{unsynced === 1 ? "" : "s"} not yet minted
                          </div>
                          <p className="mt-1.5 text-[13px] leading-relaxed text-slate-300 max-w-[520px]">
                            You hold {wholeOwned} whole PRISM but {nftCount} Prism NFT{nftCount === 1 ? "" : "s"}. The mirror mints at
                            most 128 per transfer. Fees stream only to NFTs that exist, so the missing{" "}
                            {unsynced === 1 ? "one earns" : `${unsynced} earn`} nothing until minted. Resync fixes it in one
                            transaction.
                          </p>
                        </div>
                        <button
                          onClick={resync}
                          disabled={syncState === "probing" || syncState === "wallet" || syncState === "mining"}
                          className={`${BTN_PRIMARY} !py-2.5 disabled:opacity-60`}
                          style={btnPrimary}
                        >
                          {syncState === "probing" || syncState === "wallet"
                            ? "Confirm in wallet…"
                            : syncState === "mining"
                              ? "Resyncing…"
                              : syncState === "more"
                                ? "Partly synced, run again"
                                : "Resync now"}
                        </button>
                      </div>
                    )}

                    <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                      {user.tokens.slice(0, gridShown).map((t) => {
                        const on = selected.has(t.id.toString());
                        const hasFees = t.owedETH > 0n || t.owedPRISM > 0n;
                        return (
                          <button
                            key={t.id.toString()}
                            onClick={() =>
                              setSelected((s) => {
                                const n = new Set(s);
                                const k = t.id.toString();
                                if (n.has(k)) n.delete(k); else n.add(k);
                                return n;
                              })
                            }
                            className={`relative rounded-2xl border p-3 text-left transition-colors ${on ? "border-emerald-300/50 bg-emerald-300/[0.06]" : "border-white/10 bg-white/[0.02] hover:border-white/25"}`}
                          >
                            <span
                              className={`absolute right-2.5 top-2.5 grid h-5 w-5 place-items-center rounded-full border text-[11px] ${on ? "border-emerald-300 bg-emerald-300 text-black" : "border-white/25 text-transparent"}`}
                            >
                              ✓
                            </span>
                            {t.image ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={t.image} alt={t.name} loading="lazy" className="aspect-square w-full rounded-xl bg-black/40 object-cover" />
                            ) : (
                              <div className="aspect-square w-full rounded-xl bg-black/40 grid place-items-center text-2xl">🔻</div>
                            )}
                            <div className="mt-2.5 text-[13px] font-semibold text-white truncate">{t.name}</div>
                            <div className="mt-1 text-[11px] leading-relaxed text-slate-400" style={{ fontFamily: MONO }}>
                              {hasFees ? (
                                <>
                                  Ξ{fmtEth(t.owedETH)}
                                  <br />
                                  {fmtPrism(t.owedPRISM)} PRISM
                                </>
                              ) : (
                                "nothing pending"
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {user.tokens.length > gridShown && (
                      <button
                        onClick={() => setGridShown((n) => n + 48)}
                        className="mt-4 w-full rounded-xl border border-white/10 bg-white/[0.03] py-2.5 text-[13px] font-semibold text-slate-300 hover:text-white hover:border-white/25 transition-colors"
                      >
                        Show {Math.min(48, user.tokens.length - gridShown)} more of {user.tokens.length} Prisms
                      </button>
                    )}

                    {!allSelected && selected.size > 0 && (
                      <div className="mt-3 text-[12px] text-slate-500" style={{ fontFamily: MONO }}>
                        selected: Ξ{fmtEth(selectedTotals.e)} + {fmtPrism(selectedTotals.p)} PRISM{usdOf(selectedTotals.e, selectedTotals.p, overview) ? ` · ${usdOf(selectedTotals.e, selectedTotals.p, overview)}` : ""}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-5 rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4" style={glass}>
                    <span className="text-[14px] text-slate-400">
                      {!PRISM_LIVE
                        ? "A new PRISM is launching soon, led by the community. Once it's live, every whole PRISM you hold becomes a claimable Prism NFT with its own fee stream, and this hub lights up then."
                        : `No Prism in this wallet${dustOwned > 0 ? ` beyond ${dustOwned.toFixed(4)} PRISM of dust` : ""}. A whole PRISM becomes a claimable Prism NFT with its own fee stream.`}
                    </span>
                    {UNISWAP_PRISM && (
                      <a href={UNISWAP_PRISM} target="_blank" rel="noopener noreferrer" className={`${BTN_PRIMARY} !py-2.5 shrink-0`} style={btnPrimary}>
                        Get PRISM ↗
                      </a>
                    )}
                  </div>
                )}

                {/* dust → next whole Prism progress */}
                {dustOwned > 0.0005 && (
                  <div className="mt-5 rounded-2xl p-5" style={glass}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] uppercase tracking-[0.2em] text-slate-400 font-semibold">Your next Prism</span>
                      <span className="text-[12px] text-slate-400 tabular-nums" style={{ fontFamily: MONO }}>
                        {(1 - dustOwned).toFixed(4)} PRISM away
                      </span>
                    </div>
                    <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-white/5">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, dustOwned * 100).toFixed(1)}%`,
                          background: "linear-gradient(90deg,#ff5a5a,#ff9f1c,#ffe14d,#5cff8f,#3bd9ff,#6a8bff,#c06aff)",
                          boxShadow: "0 0 14px rgba(140,120,255,0.45)",
                        }}
                      />
                    </div>
                    <p className="mt-2.5 text-[12px] leading-relaxed text-slate-500">
                      You hold {dustOwned.toFixed(4)} PRISM of dust. Top it up to a whole PRISM and it materializes as a new Prism NFT with its own fee stream.
                    </p>
                  </div>
                )}


                {tx?.phase === "done" && (
                  <div className="mt-5 rounded-2xl p-4 text-[13px] text-emerald-300" style={{ ...glass, borderTop: `2px solid ${C.green}80` }}>
                    {tx.kind === "claim"
                      ? "Fees realized. The button above now withdraws everything to your wallet."
                      : "Withdrawn. The ETH and PRISM are in your wallet."}{" "}
                    <a href={`https://etherscan.io/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                      View on Etherscan ↗
                    </a>
                  </div>
                )}
                {tx?.phase === "mining" && tx.hash && (
                  <div className="mt-3 text-[12px] text-slate-500" style={{ fontFamily: MONO }}>
                    tx {short(tx.hash)} · <a href={`https://etherscan.io/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">Etherscan ↗</a>
                  </div>
                )}
                {txErr && <div className="mt-3 text-[12px] text-red-300">{txErr}</div>}
              </>
            )}
          </div>
        )}
        </div>

        {/* ── connect-wallet popup ── */}
        {pickerOpen && !account && (
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center p-4"
            style={{ background: "rgba(4,4,8,0.72)", backdropFilter: "blur(6px)" }}
            onMouseDown={(e) => e.target === e.currentTarget && setPickerOpen(false)}
          >
            <div className="w-full max-w-[420px] rounded-3xl border border-white/12 p-5" style={{ background: "rgba(16,16,22,0.97)", boxShadow: "0 30px 90px rgba(0,0,0,0.6)" }}>
              <div className="flex items-center justify-between">
                <span className="text-[17px] font-bold tracking-tight text-white">Connect a wallet</span>
                <button onClick={() => setPickerOpen(false)} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full border border-white/10 text-slate-400 hover:text-white hover:border-white/25">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                </button>
              </div>

              <div className="mt-4 flex flex-col gap-2 max-h-[52vh] overflow-y-auto pr-0.5">
                {wallets.map((w) => (
                  <button
                    key={w.info.uuid}
                    onClick={() => connect(w)}
                    disabled={connecting != null}
                    className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left transition-colors hover:border-white/25 hover:bg-white/[0.06] disabled:opacity-60"
                  >
                    {w.info.icon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={w.info.icon} alt="" className="h-8 w-8 rounded-lg" />
                    ) : (
                      <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/10 text-[15px]">👛</span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-semibold text-white truncate">{w.info.name}</span>
                      <span className="block text-[11px] text-slate-500">{connecting === w.info.uuid ? "confirm in the wallet…" : "Detected"}</span>
                    </span>
                    <span className="h-2 w-2 rounded-full bg-emerald-400" style={{ boxShadow: "0 0 8px rgba(52,211,153,0.8)" }} />
                  </button>
                ))}

                {POPULAR_WALLETS.filter((p) => !wallets.some((w) => (w.info.rdns && w.info.rdns === p.rdns) || w.info.name.toLowerCase().includes(p.match))).map((p) => (
                  <a
                    key={p.rdns}
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.015] px-4 py-3 transition-colors hover:border-white/20"
                  >
                    <span className="grid h-8 w-8 place-items-center rounded-lg text-[13px] font-bold text-white/85" style={{ background: p.tint }}>{p.name[0]}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-semibold text-slate-300 truncate">{p.name}</span>
                      <span className="block text-[11px] text-slate-600">Not detected in this browser</span>
                    </span>
                    <span className="text-[12px] text-slate-400">Install ↗</span>
                  </a>
                ))}
              </div>

              <p className="mt-4 text-[11px] leading-relaxed text-slate-600">
                On mobile, open this page inside your wallet&apos;s own browser and it appears here automatically.
              </p>
            </div>
          </div>
        )}

        {/* off-screen share card (rendered on demand, captured at 2×) */}
        {user && user.tokens.length > 0 && (
          <div style={{ position: "fixed", left: -100000, top: 0, pointerEvents: "none" }} aria-hidden>
            <div
              ref={shareRef}
              style={{
                width: 1200,
                height: 630,
                position: "relative",
                overflow: "hidden",
                background: "linear-gradient(140deg, #14101f 0%, #0a0810 55%, #050408 100%)",
                color: "#f8fafc",
                fontFamily: '"Plus Jakarta Sans", ui-sans-serif, sans-serif',
                padding: 64,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <div style={{ position: "absolute", left: -140, bottom: -180, width: 560, height: 560, borderRadius: "50%", background: "radial-gradient(circle, rgba(140,120,255,0.5), transparent 68%)", filter: "blur(30px)" }} />
              <div style={{ position: "absolute", right: -120, top: -150, width: 460, height: 460, borderRadius: "50%", background: "radial-gradient(circle, rgba(59,217,255,0.32), transparent 70%)", filter: "blur(38px)" }} />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative" }}>
                <span style={{ fontWeight: 900, fontSize: 30, letterSpacing: "-0.5px" }}>THE PRISM MOTHERSHIP</span>
                <span style={{ fontFamily: MONO, fontSize: 18, color: "#8b95a8" }}>{user.ens || (account ? short(account) : "")}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 44, position: "relative" }}>
                <div style={{ display: "flex", gap: 14 }}>
                  {user.tokens.slice(0, 3).map((t) =>
                    t.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={t.id.toString()} src={t.image} alt="" style={{ width: 168, height: 168, borderRadius: 22, background: "rgba(0,0,0,0.4)", boxShadow: "0 0 0 2.5px rgba(200,150,255,0.7), 0 18px 44px rgba(0,0,0,0.5)" }} />
                    ) : null,
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1.05 }}>
                    {user.tokens.length} Prism{user.tokens.length === 1 ? "" : "s"}, streaming fees
                  </div>
                  <div style={{ marginTop: 16, fontFamily: MONO, fontSize: 26, color: "#e2e8f0" }}>
                    earned Ξ{fmtEth(user.lifetimeClaimedETH + allTotals.e)} + {fmtPrism(user.lifetimeClaimedPRISM + allTotals.p)} PRISM
                    {usdOf(user.lifetimeClaimedETH + allTotals.e, user.lifetimeClaimedPRISM + allTotals.p, overview) && (
                      <span style={{ color: "#6ee7b7" }}> ≈ {usdOf(user.lifetimeClaimedETH + allTotals.e, user.lifetimeClaimedPRISM + allTotals.p, overview)}</span>
                    )}
                  </div>
                  <div style={{ marginTop: 10, fontSize: 19, color: "#94a3b8" }}>Every whole PRISM is an NFT with fees streamed to it from the pool.</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative" }}>
                <span style={{ fontFamily: MONO, fontSize: 18, letterSpacing: 2, textTransform: "uppercase", color: "#64748b" }}>prismbeat.xyz/claim</span>
                <span style={{ height: 10, width: 320, borderRadius: 999, background: "linear-gradient(90deg,#ff5a5a,#ff9f1c,#ffe14d,#5cff8f,#3bd9ff,#6a8bff,#c06aff)" }} />
              </div>
            </div>
          </div>
        )}

        {/* the hold-to-execute gate in front of both consequential actions */}
        {authorize && user && (
          <AuthorizeModal
            open
            title={authorize === "claim" ? "Authorize claim" : "Authorize withdrawal"}
            rows={
              authorize === "claim"
                ? [
                    {
                      label: `Realizing across ${selected.size} Prism${selected.size === 1 ? "" : "s"}`,
                      value: `Ξ${fmtEth(selectedTotals.e)} + ${fmtPrism(selectedTotals.p)} PRISM`,
                    },
                    ...(usdOf(selectedTotals.e, selectedTotals.p, overview)
                      ? [{ label: "Approximate value", value: usdOf(selectedTotals.e, selectedTotals.p, overview)! }]
                      : []),
                  ]
                : [
                    {
                      label: "To your wallet",
                      value: `Ξ${fmtEth(user.pendingETH)} + ${fmtPrism(user.pendingPRISM)} PRISM`,
                    },
                    ...(usdOf(user.pendingETH, user.pendingPRISM, overview)
                      ? [{ label: "Approximate value", value: usdOf(user.pendingETH, user.pendingPRISM, overview)! }]
                      : []),
                  ]
            }
            warning={
              authorize === "claim"
                ? "Claiming realizes these fees into your address balance. Nothing reaches your wallet until you withdraw (step 2, one more transaction)."
                : "This sends the realized balance to your wallet. Gas is paid from your wallet's ETH; until it mines, nothing has moved."
            }
            actionLabel={authorize === "claim" ? "Hold to claim" : "Hold to withdraw"}
            onConfirm={() => {
              const kind = authorize;
              setAuthorize(null);
              if (kind) runTx(kind);
            }}
            onClose={() => setAuthorize(null)}
          />
        )}

        {/* claim celebration — a brief full-spectrum moment */}
        {celebrate && (
          <div className="fixed inset-0 z-[130] pointer-events-none flex items-center justify-center">
            <div className="absolute inset-0" style={{ background: "radial-gradient(60% 60% at 50% 45%, rgba(140,120,255,0.16), transparent 70%)", animation: "prism-celebrate-fade 3.2s ease-out forwards" }} />
            {Array.from({ length: 24 }).map((_, i) => (
              <span
                key={i}
                className="absolute h-2.5 w-2.5 rounded-full"
                style={{
                  background: ["#ff5a5a", "#ff9f1c", "#ffe14d", "#5cff8f", "#3bd9ff", "#6a8bff", "#c06aff"][i % 7],
                  left: "50%",
                  top: "45%",
                  animation: `prism-confetti 2.6s cubic-bezier(0.16,1,0.3,1) forwards`,
                  animationDelay: `${(i % 8) * 0.05}s`,
                  ["--dx" as never]: `${Math.cos((i / 24) * Math.PI * 2) * (120 + (i % 5) * 60)}px`,
                  ["--dy" as never]: `${Math.sin((i / 24) * Math.PI * 2) * (90 + (i % 4) * 55) - 60}px`,
                }}
              />
            ))}
            <div className="relative rounded-3xl border border-white/15 px-8 py-6 text-center" style={{ background: "rgba(12,12,18,0.94)", boxShadow: "0 30px 90px rgba(0,0,0,0.55)", animation: "prism-celebrate-pop 3.2s ease-out forwards" }}>
              <div className="text-[15px] font-bold tracking-tight text-white">Claimed 🔻</div>
              <div className="mt-1.5 text-[20px] font-bold text-white tabular-nums" style={{ fontFamily: MONO }}>
                Ξ{fmtEth(celebrate.e)} + {fmtPrism(celebrate.p)} PRISM
              </div>
              {usdOf(celebrate.e, celebrate.p, overview) && (
                <div className="mt-0.5 text-[13px] tabular-nums" style={{ fontFamily: MONO, color: "#6ee7b7" }}>≈ {usdOf(celebrate.e, celebrate.p, overview)}</div>
              )}
            </div>
          </div>
        )}

        <p className="mt-8 text-[11px] leading-relaxed text-slate-600" style={{ fontFamily: MONO }}>
          Reads and claims go straight to the PrismHook contract{" "}
          <a href={`https://etherscan.io/address/${HOOK_ADDRESS}`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-slate-400">
            {short(HOOK_ADDRESS)} ↗
          </a>
          . This page never holds funds.
        </p>
      </main>
    </MothershipShell>
  );
}

// ── the rainbow supply bar ────────────────────────────────────────────────────
// One bar = the whole 5,000 cap. Whole PRISM carries the full spectrum (it IS
// the prism); dust glows gold, the pool runs blue→violet, burned is smoke.
// Hover (or tap) a segment or its legend chip for the breakdown.
interface BarSeg {
  k: string;
  label: string;
  value: number;
  desc: string;
  bg: string;
  dot: string;
  animated?: boolean;
}

function RainbowBar({ stats }: { stats: ClaimStats }) {
  const [hover, setHover] = useState<string | null>(null);

  const segs: BarSeg[] = [
    stats.whole != null && {
      k: "whole",
      label: "Held whole",
      value: stats.whole,
      desc: "Whole Prisms in holders' wallets, each one an NFT with fees streaming to it",
      bg: "linear-gradient(90deg,#ff5a5a,#ff9f1c,#ffe14d,#5cff8f,#3bd9ff,#6a8bff,#c06aff)",
      dot: "#5cff8f",
      animated: true,
    },
    stats.dust != null && {
      k: "dust",
      label: "Dust",
      value: stats.dust,
      desc: "Fractional PRISM scattered across wallets, less than a whole Prism",
      bg: "linear-gradient(90deg,#ffe14d,#ff9f1c)",
      dot: "#ffc93d",
    },
    {
      k: "pool",
      label: "In the pool",
      value: stats.pool,
      desc: "PRISM sitting inside the trading pool, the liquidity everyone trades against",
      bg: "linear-gradient(90deg,#3bd9ff,#6a8bff,#c06aff)",
      dot: "#8f7bff",
    },
    {
      k: "burned",
      label: "Burned",
      value: stats.burned,
      desc: "Bought back and destroyed forever, gone from the 5,000",
      bg: "linear-gradient(90deg,#3a3a42,#1c1c22)",
      dot: "rgba(255,255,255,0.35)",
    },
  ].filter(Boolean) as BarSeg[];

  const total = segs.reduce((s, x) => s + x.value, 0) || stats.cap;
  // display widths: true proportions, but every segment stays hoverable
  const MIN_W = 2.2;
  const rawW = segs.map((s) => (s.value / total) * 100);
  const bump = rawW.map((w) => Math.max(w, MIN_W));
  const scale = 100 / bump.reduce((s, w) => s + w, 0);
  const widths = bump.map((w) => w * scale);

  const pct = (v: number) => ((v / stats.cap) * 100).toFixed(1);

  return (
    <div className="mt-5">
      <div className="flex w-full items-stretch" style={{ height: 34 }}>
        {segs.map((s, i) => {
          const on = hover === s.k;
          const dim = hover != null && !on;
          return (
            <div
              key={s.k}
              className="relative h-full cursor-pointer"
              style={{ width: `${widths[i]}%`, zIndex: on ? 3 : 1 }}
              onMouseEnter={() => setHover(s.k)}
              onMouseLeave={() => setHover(null)}
              onPointerDown={() => setHover(on ? null : s.k)}
            >
              <div
                className="h-full w-full transition-all duration-200"
                style={{
                  background: s.bg,
                  backgroundSize: s.animated ? "300% 100%" : undefined,
                  animation: s.animated ? "prism-bar-pan 7s linear infinite" : undefined,
                  borderRadius: i === 0 ? "999px 0 0 999px" : i === segs.length - 1 ? "0 999px 999px 0" : 0,
                  transform: on ? "scaleY(1.22)" : "scaleY(1)",
                  filter: dim ? "brightness(0.45) saturate(0.7)" : on ? "brightness(1.12)" : "none",
                  boxShadow: on ? `0 0 26px ${s.dot}66, 0 6px 20px rgba(0,0,0,0.45)` : "inset 0 1px 0 rgba(255,255,255,0.18)",
                }}
              />
              {on && (
                <div
                  className="absolute bottom-full mb-3 w-max max-w-[240px] rounded-xl border border-white/12 px-3.5 py-2.5 pointer-events-none"
                  style={{
                    background: "rgba(10,10,14,0.96)",
                    boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
                    left: i === 0 ? 0 : undefined,
                    right: i === segs.length - 1 ? 0 : undefined,
                    ...(i !== 0 && i !== segs.length - 1 ? { left: "50%", transform: "translateX(-50%)" } : {}),
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.dot }} />
                    <span className="text-[12px] font-bold text-white">{s.label}</span>
                  </div>
                  <div className="mt-1 text-[17px] font-bold text-white tabular-nums" style={{ fontFamily: MONO }}>
                    {s.value >= 100 ? Math.round(s.value).toLocaleString() : s.value.toFixed(2)}
                    <span className="text-[11px] font-semibold text-slate-400"> PRISM · {pct(s.value)}%</span>
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed text-slate-400">{s.desc}</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3.5 flex flex-wrap gap-x-5 gap-y-2">
        {segs.map((s) => (
          <button
            key={s.k}
            onMouseEnter={() => setHover(s.k)}
            onMouseLeave={() => setHover(null)}
            className={`flex items-center gap-2 text-[13px] transition-opacity ${hover != null && hover !== s.k ? "opacity-40" : ""}`}
            style={{ fontFamily: MONO }}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.dot }} />
            <span className="text-slate-400">{s.label}</span>
            <span className="text-white font-semibold tabular-nums">{s.value >= 100 ? Math.round(s.value).toLocaleString() : s.value.toFixed(2)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
