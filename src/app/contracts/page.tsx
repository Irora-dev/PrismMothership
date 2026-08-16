"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MothershipShell } from "@/components/mothership/shell";
import { AmbientBlooms } from "@/components/mothership/blooms";

// /contracts — plain-language contract safety, for people who don't read
// Solidity. A natural-language search bar answers questions ("is there an
// owner?", "can anyone access the fees?") with the plain answer AND the real
// code behind it; below it, every Prism contract is a row — rainbow mark, the
// FULL address in its own pill (copy + Etherscan), and safety points with the
// verbatim code inline. Code is lifted from the Sourcify-verified deployed
// source (src/PrismHook.sol + Solady's Ownable), never paraphrased; every claim
// was checked on-chain before shipping (owner() read live, the source grepped
// for upgrade/pause/blacklist paths, the burner probed by behavior). Spectrum
// contracts join when they relaunch.

const MONO = '"SF Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const RAINBOW = "linear-gradient(135deg,#ff5a5a,#ff9f1c,#ffe14d,#5cff8f,#3bd9ff,#6a8bff,#c06aff)";

interface CodeView {
  source: string;
  body: string;
}
interface SafetyPoint {
  title: string;
  line: string;
  keywords: string[]; // natural-language search hooks
  code: CodeView;
  proof?: { label: string; href: string };
}
interface Deployment {
  chain: "ethereum" | "base" | "robinhood";
  address: string;
  explorer: string; // address page on that chain's explorer
  // Link straight to the explorer's source tab. Deliberately NOT a claim that the
  // contract is verified — the reader sees that on the explorer itself. the designer
  // reports all of these are Etherscan-verified as of 2026-07-31; that could not be
  // confirmed from here (the API needs a key we don't hold and the HTML blocks
  // scripted requests), so the page points at the proof instead of asserting it.
  verifiedHref?: string;
}
interface ContractRow {
  id: string; // anchor slug (#prism, #burner, …)
  name: string;
  address: string; // primary address (single-chain rows); multi-chain rows list deployments
  deployments?: Deployment[];
  tag: string;
  note?: string; // honest caveat shown on the row
  points: SafetyPoint[];
}

const CHAIN_SHORT: Record<Deployment["chain"], { label: string; color: string }> = {
  ethereum: { label: "ETH", color: "#8ea2ff" },
  base: { label: "BASE", color: "#4d8bff" },
  robinhood: { label: "HOOD", color: "#CCFF00" },
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const scan = (a: string) => `https://etherscan.io/address/${a}`;
// The PRISM / burner / Prism-LP / burn-address rows were REMOVED 2026-07-29 (R):
// the community is relaunching the token, and those rows quoted the old
// contract's verified source line-for-line — they can't be re-pointed by an env
// var, they have to be rebuilt against the new token's verified source once it
// exists. Spectrum's own contracts are unaffected and stay below.

const CONTRACTS: ContractRow[] = [
  {
    id: "sfactory",
    name: "Spectrum Factory",
    address: "0x4d3590a5B0aCee04Bb7Ab721B23fDdae8B880486",
    deployments: [
      { chain: "ethereum", address: "0x4d3590a5B0aCee04Bb7Ab721B23fDdae8B880486", explorer: "https://etherscan.io/address/0x4d3590a5B0aCee04Bb7Ab721B23fDdae8B880486", verifiedHref: "https://etherscan.io/address/0x4d3590a5B0aCee04Bb7Ab721B23fDdae8B880486#code" },
      { chain: "base", address: "0xa60ce83A4048f2157A65d596002541311D694E5D", explorer: "https://basescan.org/address/0xa60ce83A4048f2157A65d596002541311D694E5D", verifiedHref: "https://basescan.org/address/0xa60ce83A4048f2157A65d596002541311D694E5D#code" },
      { chain: "robinhood", address: "0x07Bfce0976b205FcfDF115F7aD1401Ab1f197e6f", explorer: "https://robinhoodchain.blockscout.com/address/0x07Bfce0976b205FcfDF115F7aD1401Ab1f197e6f", verifiedHref: "https://robinhoodchain.blockscout.com/address/0x07Bfce0976b205FcfDF115F7aD1401Ab1f197e6f#code" },
    ],
    tag: "Launches baskets on Ethereum, Base & Robinhood Chain · no admin, flat 0.003 ETH fee, fees burned",
    note: "⚠️ Check the chain before you check the address. This launch deployed from one account at matching nonces, so the SAME address is a DIFFERENT contract on different chains. 0x4d35…0486 is the factory on Ethereum but the swap router on Robinhood Chain. Every address below is labelled with its chain; looking one up on the wrong explorer will show you the wrong contract.",
    points: [
      {
        title: "No admin anywhere · probed, not promised",
        line: "16 admin-shaped functions were called on all three factories. Every one reverts or does not exist.",
        keywords: ["factory", "admin", "owner", "spectrum", "control", "shut", "down", "stop", "rug", "pause", "upgrade"],
        code: {
          source: "reproduce it yourself · every one of these reverts, on all three chains",
          body: `$ cast call 0x4d3590a5B0aCee04Bb7Ab721B23fDdae8B880486 "owner()"      # ethereum
$ cast call 0xa60ce83A4048f2157A65d596002541311D694E5D "owner()"      # base
$ cast call 0x07Bfce0976b205FcfDF115F7aD1401Ab1f197e6f "owner()"      # robinhood
Error: execution reverted        # ← all three

# the full set probed, all reverting or absent on all three chains:
owner  paused  admin  pendingOwner  getOwner  implementation
proxiableUUID  pause  unpause  setFee  setOwner  transferOwnership
renounceOwnership  upgradeTo  setDeploysEnabled  blacklist

# and it is not a proxy, so there is nothing to swap out underneath you.
# all three EIP-1967 slots read empty on all three chains:
$ cast storage 0x4d3590a5B0aCee04Bb7Ab721B23fDdae8B880486 \\
    0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc
0x0000000000000000000000000000000000000000000000000000000000000000`,
        },
      },
      {
        title: "Anyone can launch, and the price is fixed at 0.003 ETH",
        line: "One flat fee from the first block, identical on all three chains, with no auction and no way to change it.",
        keywords: ["launch", "deploy", "cost", "price", "fee", "permissionless", "who", "can", "basket", "create", "auction"],
        code: {
          source: "read the price off the chain yourself · no allowlist, no admin gate",
          body: `$ cast call 0x4d3590a5B0aCee04Bb7Ab721B23fDdae8B880486 "LAUNCH_FEE_WEI()"
3000000000000000            # 0.003 ETH
$ cast call 0x4d3590a5B0aCee04Bb7Ab721B23fDdae8B880486 "currentDeployPrice()"
3000000000000000            # 0.003 ETH, the same on all three chains

# LAUNCH_FEE_WEI is a constant, and no setter for it exists (see the
# admin probe above). The price you are quoted is the price everyone pays.

# NOTE: an earlier design auctioned launch slots between 1 ETH and a
# 0.1 ETH floor. That is NOT this deployment. Those constants are
# absent from the live contracts:
$ cast call 0x4d3590a5B0aCee04Bb7Ab721B23fDdae8B880486 "AUCTION_FLOOR()"
Error: execution reverted`,
        },
      },
      {
        title: "Launch fees are burned, not kept",
        line: "The factory names its own burn destination on-chain, and it is the PRISM burner below, not a team wallet.",
        keywords: ["launch", "fees", "proceeds", "burn", "keep", "team", "money", "goes", "where", "treasury"],
        code: {
          source: "ask the factory where the money goes",
          body: `$ cast call 0x4d3590a5B0aCee04Bb7Ab721B23fDdae8B880486 "PRISM_BURNER_L1()"
0x2E39Ae825C697BE3e15ACd003d1398287C83D4b6   # ← the burner row below

# all three factories answer the SAME burner, and it is the only
# destination in the path. There is no fee recipient to set, because
# there is no setter (see the admin probe above).
# Follow any launch: deployBasket → burn leg → PRISM Transfer → 0x…dEaD`,
        },
        proof: { label: "The burner's own transactions", href: "https://etherscan.io/address/0x2E39Ae825C697BE3e15ACd003d1398287C83D4b6" },
      },
      {
        title: "Every basket's fee split is a constant",
        line: "25% burned on the current lineage (first-gen baskets are immutable at 10%), 5.55% interface, 5.55% launcher, creator capped at 30%.",
        keywords: ["fees", "split", "fee", "change", "setfee", "constant", "holders", "creator", "cut", "take"],
        code: {
          source: "read from the first basket launched by this factory, not from a document",
          body: `$ cast call <basket> "BURN_SHARE_BPS()"        # 1000 on gen-1 baskets · the lineage standard is 2500 = 25%
$ cast call <basket> "INTERFACE_SHARE_BPS()"   #  555  =  5.55%
$ cast call <basket> "LAUNCHER_SHARE_BPS()"    #  555  =  5.55%
$ cast call <basket> "MAX_CREATOR_SHARE_BPS()" # 3000  = 30% CEILING on the creator
$ cast call <basket> "owner()"
Error: execution reverted                      # baskets have no owner either

# Everything not in those slices belongs to holders. They are constants
# in the basket's own code. There is no function that can change any of
# them after launch, on any basket, by anyone.`,
        },
      },
      {
        title: "You can always exit",
        line: "redeemInKind hands you the underlying tokens directly: no pool, no admin, no permission needed.",
        keywords: ["exit", "redeem", "withdraw", "trapped", "locked", "sell", "get", "out", "liquidity"],
        code: {
          source: "src/SpectrumBasket.sol · redeemInKind, verbatim",
          body: `function redeemInKind(uint256 amount, bool[] calldata legMask, address to)
    external nonReentrant
{
    uint256 len = basket.length;
    if (legMask.length != len) revert BadLegMask();
    if (amount == 0) revert NoOutput();
    if (to == address(0)) revert InvalidAsset();
    // burns your basket tokens and transfers you the underlying assets
    // pro-rata — depends on nothing but the contract's own balances.`,
        },
        proof: { label: "Verified source (Basescan)", href: "https://basescan.org/address/0xa60ce83A4048f2157A65d596002541311D694E5D#code" },
      },
    ],
  },
  {
    id: "srouter",
    name: "Spectrum Swap Router",
    address: "0x2eC8C0C87946ead5f9AE436374F6A6d0191c6803",
    deployments: [
      { chain: "ethereum", address: "0x2eC8C0C87946ead5f9AE436374F6A6d0191c6803", explorer: "https://etherscan.io/address/0x2eC8C0C87946ead5f9AE436374F6A6d0191c6803", verifiedHref: "https://etherscan.io/address/0x2eC8C0C87946ead5f9AE436374F6A6d0191c6803#code" },
      { chain: "base", address: "0x2E39Ae825C697BE3e15ACd003d1398287C83D4b6", explorer: "https://basescan.org/address/0x2E39Ae825C697BE3e15ACd003d1398287C83D4b6", verifiedHref: "https://basescan.org/address/0x2E39Ae825C697BE3e15ACd003d1398287C83D4b6#code" },
      { chain: "robinhood", address: "0x4d3590a5B0aCee04Bb7Ab721B23fDdae8B880486", explorer: "https://robinhoodchain.blockscout.com/address/0x4d3590a5B0aCee04Bb7Ab721B23fDdae8B880486", verifiedHref: "https://robinhoodchain.blockscout.com/address/0x4d3590a5B0aCee04Bb7Ab721B23fDdae8B880486#code" },
    ],
    tag: "Routes basket swaps through Uniswap V4 · stateless, holds nothing, owns nothing",
    note: "⚠️ Chain-specific addresses again: 0x2E39…B4b6 is this router on Base, but on Ethereum the very same address is the PRISM burner. Match the chain label before you look it up.",
    points: [
      {
        title: "No admin surface · live-probed on all three chains",
        line: "owner() and paused() revert on every deployment; nothing here can be paused, upgraded or swept.",
        keywords: ["router", "admin", "owner", "swap", "control", "pause", "sweep"],
        code: {
          source: "src/periphery/SpectrumSwapRouter.sol · the header, verbatim",
          body: `• NO ADMIN SURFACE. No owner, pauser, upgrader, fee-setter, or sweep.

contract SpectrumSwapRouter is IUnlockCallback {

# confirmed live, not just asserted in a comment:
$ cast call 0x2eC8C0C87946ead5f9AE436374F6A6d0191c6803 "owner()"   # ethereum
$ cast call 0x2E39Ae825C697BE3e15ACd003d1398287C83D4b6 "owner()"   # base
$ cast call 0x4d3590a5B0aCee04Bb7Ab721B23fDdae8B880486 "owner()"   # robinhood
Error: execution reverted        # ← all three`,
        },
      },
      {
        title: "It never holds your money",
        line: "The router is a pass-through for one swap; it keeps no balances between calls.",
        keywords: ["router", "custody", "hold", "funds", "money", "balance", "stuck", "safe"],
        code: {
          source: "why a stateless router matters",
          body: `// The router unlocks the Uniswap V4 PoolManager, performs your swap
// inside the callback, and settles in the same transaction. It stores
// no user balances, so there is no pot for anyone to drain and nothing
// to rescue with an admin function — which is why it needs none.`,
        },
        proof: { label: "Its transactions on Etherscan", href: "https://etherscan.io/address/0x2eC8C0C87946ead5f9AE436374F6A6d0191c6803" },
      },
    ],
  },
  {
    id: "burner",
    name: "PRISM Burner (L1)",
    address: "0x2E39Ae825C697BE3e15ACd003d1398287C83D4b6",
    deployments: [
      { chain: "ethereum", address: "0x2E39Ae825C697BE3e15ACd003d1398287C83D4b6", explorer: "https://etherscan.io/address/0x2E39Ae825C697BE3e15ACd003d1398287C83D4b6", verifiedHref: "https://repo.sourcify.dev/1/0x2E39Ae825C697BE3e15ACd003d1398287C83D4b6" },
    ],
    tag: "Ethereum only · receives every basket's burn leg, buys PRISM and destroys it",
    note: "This replaced the previous burner on 2026-07-30. The old one hardcoded the exploited v1 PRISM with no owner and no setter, so it could never be pointed at the community relaunch. Trustless, but permanently stuck. This one is source-verified; the old one never was.",
    points: [
      {
        title: "Source-verified, and bound to the token this site reads",
        line: "Sourcify reports an exact bytecode match, and the burner names PRISM v2 itself.",
        keywords: ["burner", "verified", "source", "code", "trust", "which", "token", "prism"],
        code: {
          source: "ask the burner which token it burns",
          body: `$ cast call 0x2E39Ae825C697BE3e15ACd003d1398287C83D4b6 "PRISM()"
0xCf4d29f14Cc585DDd1167F956092852AF844e040   # ← PRISM v2, the token
                                             #   every figure on this
                                             #   site is read from
$ cast code 0x2E39Ae825C697BE3e15ACd003d1398287C83D4b6 | wc -c
# ~2.8KB, small enough to read end to end in one sitting`,
        },
        proof: { label: "Verified source (Sourcify, exact match)", href: "https://repo.sourcify.dev/1/0x2E39Ae825C697BE3e15ACd003d1398287C83D4b6" },
      },
      {
        title: "No owner, and nothing to withdraw",
        line: "ETH arrives, PRISM is bought and sent to a dead address in the same transaction.",
        keywords: ["burner", "owner", "admin", "withdraw", "steal", "drain", "rug", "keep"],
        code: {
          source: "the burn destination is the standard dead address",
          body: `$ cast call 0x2E39Ae825C697BE3e15ACd003d1398287C83D4b6 "owner()"
Error: execution reverted     # no owner, so no privileged withdrawal

// PRISM bought here is transferred to:
0x000000000000000000000000000000000000dEaD
// an address with no code and no private key. Nobody holds it,
// so nothing sent there can ever come back — including for us.`,
        },
        proof: { label: "The dead address on Etherscan", href: "https://etherscan.io/address/0x000000000000000000000000000000000000dEaD" },
      },
      {
        title: "It has actually run · once, with real value",
        line: "0.05 ETH in, 4.128439854822168758 PRISM destroyed. Before this, the burn path was untested in production.",
        keywords: ["burn", "happened", "real", "proof", "first", "worked", "tested", "flywheel"],
        code: {
          source: "the first end-to-end burn, 2026-07-30",
          body: `0.05 ETH  →  4.128439854822168758 PRISM  →  0x…dEaD

// Two things this proved that a testnet cannot:
//  1. the burner finished holding ZERO PRISM and ZERO fee-share NFTs.
//     A burner left holding whole PRISM would mint itself fee-share
//     NFTs it can never claim, quietly diluting real holders.
//  2. no ETH was stranded in the contract afterwards.
// That figure is the same "total PRISM burnt" you see on the homepage.`,
        },
        proof: { label: "PRISM sent to the dead address", href: "https://etherscan.io/token/0xCf4d29f14Cc585DDd1167F956092852AF844e040?a=0x000000000000000000000000000000000000dEaD" },
      },
    ],
  },
  {
    id: "leaguepool",
    name: "League Pool",
    address: "0xd1B485a0C40fb40fd94aa8dDbA32Ed6DCaDC35Be",
    deployments: [
      { chain: "robinhood", address: "0xd1B485a0C40fb40fd94aa8dDbA32Ed6DCaDC35Be", explorer: "https://robinhoodchain.blockscout.com/address/0xd1B485a0C40fb40fd94aa8dDbA32Ed6DCaDC35Be", verifiedHref: "https://robinhoodchain.blockscout.com/address/0xd1B485a0C40fb40fd94aa8dDbA32Ed6DCaDC35Be#code" },
    ],
    tag: "Robinhood Chain only · holds creator-league rewards, and its one privileged call is already spent",
    points: [
      {
        title: "Its single privileged call has been used up",
        line: "seatFactory could be called exactly once, to name the factory. That happened at launch and can never happen again.",
        keywords: ["league", "pool", "seat", "factory", "admin", "once", "privileged", "rewards"],
        code: {
          source: "check which factory it is bound to, and that it is the live one",
          body: `$ cast call 0xd1B485a0C40fb40fd94aa8dDbA32Ed6DCaDC35Be "factory()" \\
    --rpc-url https://rpc.mainnet.chain.robinhood.com/rpc
0x07Bfce0976b205FcfDF115F7aD1401Ab1f197e6f   # ← the live Robinhood factory

// seatFactory() is a one-shot: once a factory is seated it reverts
// forever. It was called during the launch ceremony, so from here on
// the pool has no privileged caller for the rest of its life.`,
        },
      },
    ],
  },
];

// ── natural-language search ───────────────────────────────────────────────────
const SUGGESTIONS = [
  "Is there an owner for any of the contracts?",
  "Are they immutable?",
  "Can anyone access the fees?",
  "Who can launch a basket?",
  "Can I always exit a basket?",
  "Can more PRISM be minted?",
  "Can transfers be paused or blacklisted?",
  "Where does burned PRISM go?",
];

const STOP = new Set(["the", "a", "an", "is", "are", "can", "any", "anyone", "for", "of", "to", "do", "does", "there", "they", "them", "it", "be", "or", "and", "in", "on", "with", "your", "you", "i"]);

interface Hit {
  contract: ContractRow;
  point: SafetyPoint;
  score: number;
}

function searchPoints(query: string): Hit[] {
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t));
  if (!tokens.length) return [];
  const hits: Hit[] = [];
  for (const c of CONTRACTS) {
    for (const p of c.points) {
      let score = 0;
      const hay = `${p.title} ${p.line}`.toLowerCase();
      for (const t of tokens) {
        if (p.keywords.some((k) => k.includes(t) || t.includes(k))) score += 3;
        if (hay.includes(t)) score += 1;
      }
      if (score > 0) hits.push({ contract: c, point: p, score });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 3);
}

// ── lightweight syntax highlighting (solidity/shell-ish, zero deps) ──────────
const KEYWORDS = /\b(function|returns?|external|internal|private|public|view|payable|constant|constructor|contract|modifier|event|emit|revert|if|else|for|require|virtual|override|onlyOwner|onlyHook|memory|calldata|storage|uint\d*|int\d*|address|bool|bytes\d*|string|mapping|indexed|true|false|new)\b/;
function highlight(code: string): ReactNode[] {
  return code.split("\n").map((ln, i) => {
    const out: ReactNode[] = [];
    // whole-line comments (solidity /// // and shell # $)
    const cm = ln.match(/^(\s*)(\/\/.*|#.*|\$.*)$/);
    if (cm) {
      out.push(cm[1], <span key="c" style={{ color: cm[2].startsWith("$") ? "#7dd3fc" : "#5b8a6f" }}>{cm[2]}</span>);
    } else {
      // inline comment split
      const ci = ln.indexOf("//");
      const codePart = ci >= 0 ? ln.slice(0, ci) : ln;
      const commentPart = ci >= 0 ? ln.slice(ci) : "";
      // tokenize the code part: strings, numbers, keywords
      const re = new RegExp(`("[^"]*")|(\\b0x[a-fA-F0-9]+\\b|\\b\\d[\\d_]*(?:\\.\\d+)?(?:e\\d+)?\\b)|${KEYWORDS.source}`, "g");
      let last = 0;
      let m: RegExpExecArray | null;
      let k = 0;
      while ((m = re.exec(codePart))) {
        if (m.index > last) out.push(codePart.slice(last, m.index));
        const [tok] = m;
        const color = m[1] ? "#ffd28a" : m[2] ? "#9ecfff" : "#c996ff";
        out.push(<span key={`t${k++}`} style={{ color }}>{tok}</span>);
        last = m.index + tok.length;
      }
      if (last < codePart.length) out.push(codePart.slice(last));
      if (commentPart) out.push(<span key="ic" style={{ color: "#5b8a6f" }}>{commentPart}</span>);
    }
    out.push("\n");
    return <span key={i}>{out}</span>;
  });
}

// "Ask your AI" — copies a ready prompt + the snippet, one tap.
const AI_PROMPT = (source: string, body: string) =>
  `This is code from a verified Ethereum smart contract (${source}). In plain English: what does it do, and does it contain any backdoor, owner privilege, or way for anyone to change it or take user funds? Be specific.\n\n\`\`\`\n${body}\n\`\`\``;

// ── live on-chain proofs (from /api/prism/verify) ─────────────────────────────
// Only Spectrum's proofs are rendered here now — the PRISM-token chips went with
// their rows (relaunch, 2026-07-29). The route still returns the token fields;
// they light up again when the new token's rows are written.
interface VerifyData {
  spectrum?: { chain: string; factoryHasOwner: boolean; routerHasOwner: boolean }[];
  checkedAt: number;
}

function LiveChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]"
      style={{
        fontFamily: MONO,
        borderColor: ok ? "rgba(52,211,153,0.35)" : "rgba(251,191,36,0.35)",
        background: ok ? "rgba(52,211,153,0.08)" : "rgba(251,191,36,0.08)",
        color: ok ? "#6ee7b7" : "#fcd34d",
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: ok ? "#34d399" : "#fbbf24", boxShadow: `0 0 6px ${ok ? "#34d399" : "#fbbf24"}` }} />
      {label}
    </span>
  );
}

// The chain's own answers, freshly read — rendered under each contract's pill.
function LiveProofs({ id, v }: { id: string; v: VerifyData | null }) {
  if (!v) return null;
  const ago = Math.max(0, Math.round((Date.now() - v.checkedAt) / 1000));
  const chips =
    id === "sfactory" && v.spectrum
      ? v.spectrum.map((d) => <LiveChip key={d.chain} ok={!d.factoryHasOwner} label={`${d.chain}: owner() → ${d.factoryHasOwner ? "answers?!" : "reverts (no admin)"}`} />)
      : id === "srouter" && v.spectrum
        ? v.spectrum.map((d) => <LiveChip key={d.chain} ok={!d.routerHasOwner} label={`${d.chain}: owner() → ${d.routerHasOwner ? "answers?!" : "reverts (no admin)"}`} />)
        : [];
  if (!chips.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {chips}
      <span className="text-[10px] text-slate-600" style={{ fontFamily: MONO }}>✓ read from the chain {ago < 5 ? "just now" : `${ago}s ago`}</span>
    </div>
  );
}

function CopyBtn({ text, label = "Copy", small = false }: { text: string; label?: string; small?: boolean }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(text).then(() => {
          setOk(true);
          setTimeout(() => setOk(false), 1400);
        });
      }}
      className={`shrink-0 rounded-md border border-white/10 text-slate-300 hover:text-white hover:border-white/25 transition-colors ${small ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-[12px]"}`}
    >
      {ok ? "Copied ✓" : label}
    </button>
  );
}

// wrap matched search terms so answers show WHY they matched
function markTerms(text: string, terms: string[]): ReactNode {
  if (!terms.length) return text;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
  // String.split with a capturing group: odd indices are the matches
  return text.split(re).map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="rounded-[3px] px-0.5" style={{ background: "rgba(140,120,255,0.28)", color: "#fff" }}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

// One safety point — big title, one-line summary, and the real code INLINE
// (syntax-highlighted), with Copy + a one-tap Ask-your-AI prompt.
function PointCard({ p, contractName, terms = [] }: { p: SafetyPoint; contractName?: string; terms?: string[] }) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <span className="flex items-center gap-2 min-w-0">
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-400/15 text-[11px] text-emerald-300">✓</span>
          <span className="text-[17px] font-bold tracking-tight text-white">{markTerms(p.title, terms)}</span>
          {contractName && (
            <span className="rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-slate-400" style={{ fontFamily: MONO }}>
              {contractName}
            </span>
          )}
        </span>
        {p.proof && (
          <a
            href={p.proof.href}
            target={p.proof.href.startsWith("/") ? undefined : "_blank"}
            rel="noopener noreferrer"
            className="shrink-0 inline-flex items-center gap-1 text-[12px] font-semibold text-cyan-300 hover:text-cyan-200"
          >
            🔎 {p.proof.label}
            {!p.proof.href.startsWith("/") && <span aria-hidden>↗</span>}
          </a>
        )}
      </div>
      <p className="mt-1.5 text-[12px] text-slate-500">{markTerms(p.line, terms)}</p>

      <div className="mt-3 rounded-lg border border-white/10 overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-white/[0.04] px-3 py-1.5">
          <span className="min-w-0 truncate text-[11px] text-slate-400" style={{ fontFamily: MONO }}>{p.code.source}</span>
          <span className="flex items-center gap-1.5 shrink-0">
            <CopyBtn text={AI_PROMPT(p.code.source, p.code.body)} label="🤖 Ask your AI" small />
            <CopyBtn text={p.code.body} label="Copy code" small />
          </span>
        </div>
        <pre className="overflow-x-auto p-3.5 text-[12px] leading-relaxed text-slate-200" style={{ fontFamily: MONO, background: "rgba(0,0,0,0.45)" }}>
          {highlight(p.code.body)}
        </pre>
      </div>
    </div>
  );
}

type SrcMap = Record<string, { verified: boolean; name?: string; unsupported?: boolean }>;

function Row({ c, verify, src }: { c: ContractRow; verify: VerifyData | null; src: SrcMap }) {
  const [open, setOpen] = useState(false);
  return (
    <div id={c.id} className="glass-card relative !overflow-visible scroll-mt-24">
      {/* the foil top rule — same language as the app-store cards */}
      <div className="absolute left-0 top-0 h-[2px] w-full rounded-t-[22px]" style={{ background: RAINBOW, opacity: 0.7 }} />
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-4 p-5 text-left">
        <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-xl" style={{ background: RAINBOW, boxShadow: "0 4px 18px rgba(140,120,255,0.35)" }}>
          <span className="grid h-[38px] w-[38px] place-items-center rounded-[10px] text-[15px] font-black tracking-tight text-white" style={{ background: "rgba(10,10,14,0.62)" }}>
            {c.name.replace(/^The /, "")[0]}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-[17px] font-bold tracking-tight text-white">{c.name}</span>
          <span className="mt-0.5 block text-[13px] text-slate-400">{c.tag}</span>
        </span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {/* the full-address pill(s) — one per chain on multi-chain rows */}
      <div className="px-5 pb-4 -mt-1 flex flex-col gap-2">
        {c.deployments ? (
          c.deployments.map((d) => (
            <div key={d.chain} className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5">
              <span
                className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-[0.1em]"
                style={{ color: CHAIN_SHORT[d.chain].color, background: `${CHAIN_SHORT[d.chain].color}18`, border: `1px solid ${CHAIN_SHORT[d.chain].color}44` }}
              >
                {CHAIN_SHORT[d.chain].label}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] md:text-[14px] text-white tabular-nums" style={{ fontFamily: MONO }} title={d.address}>
                {d.address}
              </span>
              {d.verifiedHref && (() => {
                // States only what the explorer reports right now (see
                // /api/contracts/verified). Unknown, or a chain Etherscan doesn't
                // cover, degrades to a plain source link — this page never claims a
                // verification it hasn't just been told about.
                const s = src[`${d.chain}:${d.address.toLowerCase()}`];
                return (
                  <a
                    href={d.verifiedHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className={`shrink-0 text-[11px] font-semibold ${s?.verified ? "text-emerald-300 hover:text-emerald-200" : "text-slate-400 hover:text-slate-200"}`}
                    title={
                      s?.verified
                        ? `Etherscan reports verified source: ${s.name ?? ""}`
                        : s?.unsupported
                          ? "Etherscan doesn't cover this chain, so these verify on Blockscout/Sourcify instead"
                          : "Open the explorer's source tab"
                    }
                  >
                    {s?.verified ? "✓ verified" : "view source ↗"}
                  </a>
                );
              })()}
              <CopyBtn text={d.address} small />
              <a
                href={d.explorer}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-white/10 text-slate-300 hover:text-white hover:border-white/25 transition-colors"
                title="View on the chain's explorer"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7" /><path d="M7 7h10v10" /></svg>
              </a>
            </div>
          ))
        ) : (
        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5">
          <span className="min-w-0 flex-1 truncate text-[13px] md:text-[14px] text-white tabular-nums" style={{ fontFamily: MONO }} title={c.address}>
            {c.address}
          </span>
          <CopyBtn text={c.address} small />
          <a
            href={scan(c.address)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-white/10 text-slate-300 hover:text-white hover:border-white/25 transition-colors"
            title="View on Etherscan"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7" /><path d="M7 7h10v10" /></svg>
          </a>
        </div>
        )}
        {c.note && <p className="mt-1 text-[11px] text-amber-300/80">{c.note}</p>}
        <LiveProofs id={c.id} v={verify} />
      </div>

      {open && (
        <div className="border-t border-white/5 px-5 pb-5">
          <div className="mt-4 flex flex-col gap-3">
            {c.points.map((p) => (
              <PointCard key={p.title} p={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ContractsPage() {
  const [query, setQuery] = useState("");
  const [verify, setVerify] = useState<VerifyData | null>(null);
  // Live source-verification status, so the badge reports the explorer rather
  // than a value someone typed here months ago.
  const [src, setSrc] = useState<SrcMap>({});
  const searchRef = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => searchPoints(query), [query]);
  const terms = useMemo(() => query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t)), [query]);

  // live on-chain proofs for the badges
  useEffect(() => {
    let alive = true;
    fetch("/api/contracts/verified")
      .then((r) => r.json())
      .then((d: { contracts?: SrcMap }) => { if (alive && d.contracts) setSrc(d.contracts); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    fetch("/api/prism/verify")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && !j.error && setVerify(j))
      .catch(() => {});
  }, []);

  // deep-linkable search: read ?q= on mount, keep the URL in sync while typing
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) setQuery(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (query) url.searchParams.set("q", query);
    else url.searchParams.delete("q");
    window.history.replaceState(null, "", url.toString());
  }, [query]);

  // press / anywhere to focus the search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <MothershipShell>
      <AmbientBlooms />

      <main className="container mx-auto px-4 md:px-6 max-w-[900px] py-8 md:py-12 relative z-10">
        {/* spectrum-style hero */}
        <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">
          Contracts
        </h1>
        <div className="spectrum-divider w-full mt-3" />
        <p className="mt-5 text-lg text-slate-300 leading-relaxed max-w-xl">
          You shouldn&apos;t need to read Solidity to know what you&apos;re trusting. Verify the contracts with your own eyes below.
        </p>

        {/* natural-language search */}
        <div className="mt-7">
          <div className="relative rounded-2xl p-[1.5px]" style={{ background: query ? RAINBOW : "rgba(255,255,255,0.10)" }}>
            <div className="flex items-center gap-3 rounded-2xl bg-[#0c0c11] px-4 py-3.5">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-slate-500">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ask anything… is there an owner? can anyone touch the fees?  ( / to focus )"
                className="w-full bg-transparent text-[15px] text-white outline-none placeholder:text-slate-600"
              />
              {query && (
                <button onClick={() => setQuery("")} aria-label="Clear" className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/10 text-slate-400 hover:text-white">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                </button>
              )}
            </div>
          </div>

          {/* suggested questions */}
          <div className="mt-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setQuery(s)}
                className={`rounded-full border px-3 py-1.5 text-[12px] transition-colors ${query === s ? "border-white/30 bg-white/10 text-white" : "border-white/10 bg-white/[0.03] text-slate-400 hover:text-white hover:border-white/25"}`}
              >
                {s}
              </button>
            ))}
          </div>

          {/* answers */}
          {query && (
            <div className="mt-4 flex flex-col gap-3">
              {hits.length ? (
                hits.map((h) => <PointCard key={`${h.contract.address}-${h.point.title}`} p={h.point} contractName={h.contract.name.replace(/^The /, "")} terms={terms} />)
              ) : (
                <div className="glass-card p-4 text-[13px] text-slate-500">
                  Nothing matched that. Try one of the suggested questions, or open a contract below and read every point.
                </div>
              )}
            </div>
          )}
        </div>

        {/* proper cards, two abreast — each expands independently (the designer) */}
        <div className="mt-7 grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          {CONTRACTS.map((c) => (
            <Row key={c.address} c={c} verify={verify} src={src} />
          ))}
        </div>

        <p className="mt-7 text-[12px] leading-relaxed text-slate-500">
          The Spectrum Factory and Swap Router above are the live relaunch deployments on Ethereum, Base and Robinhood Chain. Each basket a launcher deploys is its own contract, created by the factory from this exact verified code.
        </p>
      </main>
    </MothershipShell>
  );
}
