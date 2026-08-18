# Changelog

## 2026.08.18 — the portfolio system goes live end to end (.44 – .46)
Spectrum Portfolio flips to Live across the site: batched multi-asset buys and
fee-wrapped swaps are on-chain on Ethereum, Base and Robinhood Chain, and every
figure the site shows for them is measured off their own events. Wrapped swaps
price themselves from their own transaction (a stable on either leg prices the
swap, the fee and the burn cut at the trade's own executed rate). Burn money
that cannot enter the ETH-only pipeline — fees charged in sell assets, batch
burn shares whose swap did not run — is counted honestly as its own stage,
parked at the fallback awaiting the operator sweep, with live balances of
event-verified assets only. The detail popup renders wrapped swaps as
themselves, share cards opt out of shared edge caching entirely (within a cache
window, any card URL could previously serve whichever image rendered first),
and the burn page's journey, the money map's splits and the command deck's
portfolio card all carry the new measured figures.

## 2026.08.16 — the money map, the burn crank, the one-click finalize (.41 – .43)
The money map arrives at /flow: fees enter a glass prism and fan out to their
destinations, every figure measured on-chain, every pulse a real transaction.
The burn page becomes the burn crank: four honest states, three chain roads,
every step crankable by anyone — including a one-click L1 finalize for bridge
crossings that cleared their dispute window, with the Merkle proof built
against the rollup's own node interface. Plus a site-wide activity ticker,
per-page share cards, honest stale-read states on every money surface, and a
bought-and-burnt figure that had silently read zero since it was written.

## 2026.08.03 — first public kit release
The full Prism Mothership, self-hostable: live command deck, telemetry, claim hub,
burn pipeline, radio, studio, plain-language contracts. The `/setup` integrator
studio (domain · platform · RPC key, dev-mode Apply), the `create/` wizard with AI
agent detection (Claude Code, OpenAI Codex, Cursor, Trae, Kimi, Gemini, Windsurf,
Copilot), `npm run doctor` health + update check, per-platform deploys documented
for Netlify, Vercel, Cloudflare (OpenNext) and self-hosting. Canonical chain wiring
ships in the box; the site holds no funds and adds no fees — claim and
(config-gated) native-trade transactions are signed by the visitor's own wallet.
