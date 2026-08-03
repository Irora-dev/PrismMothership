# Prism Mothership kit — agent guide

You are working in the **Prism Mothership kit**: the full, self-hostable front end for
the PRISM token ecosystem (live command deck, telemetry, claim hub, burn pipeline,
radio, studio, contracts). If a person asked you to **set up, deploy, or update their
site, follow the agent runbook in [`START-HERE.md`](START-HERE.md)** — it scripts the
whole flow and its red lines are load-bearing:

- **Never change or guess a contract address** — the chain wiring in
  `src/lib/chain/constants.ts` is canonical and ships with the kit.
- **Secrets stay server-side**: keys go in `.env.local` (local) or the host's env UI
  (production), never in `NEXT_PUBLIC_*`, never committed.
- This site **never signs or sends transactions** — keep it that way.

Orientation: `src/app/*` pages · `create/index.mjs` wizard (`--help`) · `/setup`
in-browser studio · `npm run doctor` health/update check · `docs/HOSTING.md` deploys.
Verify changes with `npm run typecheck && npm run build`.
