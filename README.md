# The Prism Mothership

The full front end for the **PRISM token ecosystem** — live command deck, telemetry,
claim hub, burn pipeline, radio, studio and plain-language contract pages — packaged
as a free, self-hostable kit. **No database.** Every number is read live from the
chain; the canonical chain wiring ships in the box.

## ⚡ One-click deploy (Cloudflare)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Irora-dev/PrismMothership)

The button does everything: copies this repo into **your** GitHub, wires up
build-on-push, and deploys to Cloudflare Workers. When it asks for variables, set
`ALCHEMY_API_KEY` (your free Alchemy key) and `URL` (your https domain — you can add
the custom domain after, under the worker's **Domains & Routes**). The $5/mo Workers
plan is recommended; the free tier's CPU budget is tight for the cold chain scans.

## 🤖 Have an AI set it up — copy this one block into your agent

Works with any AI coding agent (Claude Code, OpenAI Codex, Cursor, Trae, Kimi,
Gemini, Windsurf, …). You'll only be asked for your domain, platform, and a free
Alchemy key:

```text
Set up my own Prism Mothership site.
1. Get the kit: git clone --depth 1 https://github.com/Irora-dev/PrismMothership.git
   (no git? curl -L the zip — on Windows use curl.exe, never Invoke-WebRequest).
2. Read PrismMothership/START-HERE.md and follow its AGENT RUNBOOK exactly, stage by
   stage. It is the authority — do not improvise steps it already covers, and respect
   its red lines (never touch contract addresses; keys stay server-side).
3. Ask me only for: my domain, my platform (netlify / vercel / cloudflare — those
   exact options; "Cloudflare Pages" is not one, the cloudflare option deploys to
   Workers), and my Alchemy API key. Deploying headless to Cloudflare? Ask me for a
   CLOUDFLARE_API_TOKEN instead of trying a browser login.
4. Prove it locally (npm run doctor, then npm run dev) BEFORE deploying. When live,
   give me my URL and confirm https://<my-domain>/api/feed returns "mode":"live".
```

No AI? **→ [START-HERE.md](START-HERE.md)** has the same flow for humans, or run
`node create/index.mjs` yourself. On GitHub you can also click **Use this template**
to get your own copy of the repo first — the push-to-deploy flows on Netlify, Vercel
and Cloudflare all start from a repo you own.

## What you need
- a domain
- a hosting platform (Netlify · Vercel · Cloudflare · self-host — `docs/HOSTING.md`)
- a free Alchemy API key (server-side only)

## Quick start
```sh
npm install
node create/index.mjs        # 60-second Q&A → site.config.json + .env.local
npm run dev                  # http://localhost:3090
npm run doctor               # config + env + update check
```
The in-browser version of the wizard lives at **`/setup`** on your running site.

## Updating
```sh
git remote add upstream https://github.com/Irora-dev/PrismMothership.git  # once
git fetch upstream && git merge upstream/main && npm install && npm run doctor
```
Your identity (site.config.json, .env.local) always wins the merge; the kit wins
everywhere else. `npm run doctor` tells you when a newer release exists.

## What this is (and isn't)
This software renders public on-chain data. It holds no funds, takes no cut, and
adds no fee of its own; claim and (optional, config-gated) trade transactions are
built client-side and signed only by the visitor's own wallet. Nothing in it is
investment advice. Running it makes you the operator of your own instance: see
`DISCLAIMER.md`.
