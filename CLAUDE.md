# Prism Mothership kit — Claude Code guide

If the person asked you to **set up, deploy, or update their Mothership site**,
follow the agent runbook in [`START-HERE.md`](START-HERE.md) — it scripts the whole
flow (welcome → wizard → local proof → hosting hookup → verify → updates).

The red lines there are load-bearing: never touch the canonical chain wiring in
`src/lib/chain/constants.ts`, keep every key server-side (`.env.local` / host env
UI, never `NEXT_PUBLIC_*`, never committed), and never add custody or fees — the
only transactions this site builds (claim, and native trade when
`site.config.json` enables it) are signed client-side by the visitor's own
wallet against the canonical contracts.

Verify any change with `npm run typecheck && npm run build`; `npm run doctor` checks
config, env hygiene, and whether a newer kit release exists.
