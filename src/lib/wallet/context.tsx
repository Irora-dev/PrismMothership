"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { useWalletDiscovery, type WalletOption } from "./discovery";
import { glass } from "@/components/mothership/style";

// ── One wallet for the whole ship ────────────────────────────────────────────
// the designer (2026-08-03): "the connect wallet button should just be in the top
// right anyway, not just on the trade page." The shell renders the button;
// this context owns the connection + the ONE picker modal (trade and the burn
// board previously carried identical copies). Chain switching stays with each
// action — a page checks/switches at execution time, not at connect.

interface WalletCtx {
  wallets: WalletOption[];
  wallet: WalletOption | null;
  account: string | null;
  openPicker: () => void;
}

const Ctx = createContext<WalletCtx>({ wallets: [], wallet: null, account: null, openPicker: () => {} });

export function useWallet(): WalletCtx {
  return useContext(Ctx);
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const wallets = useWalletDiscovery();
  const [wallet, setWallet] = useState<WalletOption | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const connect = useCallback(async (w: WalletOption) => {
    try {
      const accs = (await w.provider.request({ method: "eth_requestAccounts" })) as string[];
      if (!accs?.[0]) return;
      setWallet(w);
      setAccount(accs[0]);
      setPicking(false);
    } catch {
      /* user closed the wallet prompt */
    }
  }, []);

  return (
    <Ctx.Provider value={{ wallets, wallet, account, openPicker: () => setPicking(true) }}>
      {children}
      {picking && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setPicking(false)}>
          <div className="w-full max-w-sm rounded-2xl p-6" style={glass} onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 text-lg font-bold text-white">Connect a wallet</h3>
            {wallets.length === 0 && (
              <p className="text-sm leading-relaxed text-slate-400">
                No wallet detected in this browser. Install one, or open this page inside your wallet&apos;s browser.
              </p>
            )}
            <div className="space-y-2">
              {wallets.map((w) => (
                <button
                  key={w.info.uuid}
                  onClick={() => connect(w)}
                  className="flex w-full items-center gap-3 rounded-xl border border-white/10 p-3 text-left transition-colors hover:bg-white/5"
                >
                  {w.info.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={w.info.icon} alt="" className="h-8 w-8 rounded-lg" />
                  ) : (
                    <span className="h-8 w-8 rounded-lg bg-white/10" />
                  )}
                  <span className="font-semibold text-white">{w.info.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
