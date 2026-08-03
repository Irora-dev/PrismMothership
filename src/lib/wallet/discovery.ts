"use client";

import { useEffect, useState } from "react";
import type { Eip1193Provider } from "ethers";

// ── EIP-6963 wallet discovery ─────────────────────────────────────────────────
// Extracted from the claim page's proven implementation so every transactional
// surface (claim, trade) shares one copy. Discovery only sees installed
// wallets; a lone injected provider that never announces (older wallets, most
// mobile in-app browsers) is added as a fallback after a beat.

export interface WalletOption {
  info: { uuid: string; name: string; icon: string; rdns?: string };
  provider: Eip1193Provider & {
    on?: (ev: string, cb: (...a: never[]) => void) => void;
    removeListener?: (ev: string, cb: (...a: never[]) => void) => void;
    request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  };
}

export function useWalletDiscovery(): WalletOption[] {
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
