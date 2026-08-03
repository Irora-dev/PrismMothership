# START HERE — run your own Prism Mothership

This kit is the **entire Prism Mothership site** — the live command deck, telemetry,
claim hub, burn pipeline, radio, studio and contracts pages for the PRISM ecosystem —
packaged so anyone can self-host it. **No database. The chain wiring ships canonical**
(the PRISM token, pools and Spectrum factories are baked into
`src/lib/chain/constants.ts`): you bring a **domain**, a **hosting platform**, and an
**RPC key**, and you have the Mothership under your own flag in minutes.

> **Three ways in — all end at the same two files**
> (`site.config.json` = your domain + platform, committed ·
> `.env.local` = your RPC key and optional keys, gitignored):
>
> 1. **One prompt (Claude Code, OpenAI Codex, Cursor, Trae, Kimi, Gemini — any AI
>    coding agent):** paste this file in and say *"set up my Mothership."* The agent
>    runs everything below; you do only the hosting login and DNS clicks.
> 2. **CLI:** `node create/index.mjs` — a 60-second Q&A. Or run the app and open
>    **`/setup`**: fill the same values in the browser; in dev, **Apply** writes them
>    straight into the project.
> 3. **By hand:** copy `.env.example` → `.env.local`, fill `ALCHEMY_API_KEY`, and
>    create `site.config.json` (`{ "siteUrl": "https://…", "platform": "netlify" }`).
>
> You need **Node 20+** and npm.

---

## 🤖 AGENT RUNBOOK — if you are an AI coding agent, execute this yourself

**You run every technical step; never paste commands back for the user to run.** The
user answers questions and does only the truly manual pieces (hosting login, registrar
DNS). Narrate briefly, and end every message with exactly one next action for the user.

**Red lines (load-bearing — do not cross):**
- **Never change, guess, or "update" a contract address.** The chain wiring in
  `src/lib/chain/constants.ts` is canonical and versioned with the kit; integrators
  configure hosting, not contracts.
- **Secrets stay server-side.** `ALCHEMY_API_KEY` (and any key) lives in `.env.local`
  locally and in the host's env-var UI in production — never in a `NEXT_PUBLIC_*`
  var, never committed. `npm run doctor` enforces this; don't work around it.
- This site **holds no funds, takes no cut, and adds no fee of its own**. The only
  transactions it builds — claiming, and native trading when `site.config.json`'s
  `tradingMode` is `"native"` — are signed client-side by the visitor's own wallet
  against the canonical contracts. Keep it that way: no custody, no added fees, no
  new execution paths (in `"matcha"` mode, trading links out).
- Keep the repo's disclaimers and the footer attribution intact.

### Stage 0 — welcome (your FIRST message)
Say what this is (their own live dashboard for the PRISM ecosystem), what they'll end
up with (their domain serving the Mothership, live chain data, zero database), and the
three things you'll need from them: **domain**, **platform choice**, **Alchemy key**
(free tier is fine — walk them through alchemy.com → new app → Ethereum mainnet if
they don't have one). Then start Stage 1 in the same message.

Offer EXACTLY these platforms — never invent others: **Netlify · Vercel · Cloudflare ·
self-host**. If they say "Cloudflare Pages", that means the **cloudflare** option:
this kit deploys to Cloudflare **Workers** via OpenNext (Pages' Next.js support is
edge-runtime only and cannot run the kit's API routes) — tell them they keep the
Pages-style push-to-deploy workflow, and never attempt `wrangler pages deploy` or
`next-on-pages`.

### Stage 1 — get the code, install & configure
If you don't have the repo on disk yet, clone shallow — do NOT improvise a zip
download (the repo carries ~45 MB of media; PowerShell's `Invoke-WebRequest` in
particular crawls or stalls on it unless progress is silenced):
```sh
git clone --depth 1 https://github.com/Irora-dev/PrismMothership.git && cd PrismMothership
```
No git available? `curl -L -o mothership.zip https://github.com/Irora-dev/PrismMothership/archive/refs/heads/main.zip`
then unzip (on Windows that's `curl.exe`, which ships with Windows 10+; if you must
use `Invoke-WebRequest`, set `$ProgressPreference='SilentlyContinue'` first). Work in
ONE fresh, absolute path — don't nest a second copy on retries.

```sh
npm install
node create/index.mjs --yes --site-url <their-domain> --platform <netlify|vercel|cloudflare|other> --rpc <their-key>
npm run doctor      # must end "All clear" (warnings are fine to narrate)
```
(Interactive alternative: run the app with `npm run dev`, send them to `/setup`, wait
for their Apply, then `npm run doctor`.)

### Stage 2 — local proof
`npm run dev` → open http://localhost:3090 — the deck must show live numbers within
~15s (cold chain scan). If everything reads "—", the RPC key is wrong or missing:
re-check `.env.local`.

### Stage 3 — deploy (per platform — full detail in `docs/HOSTING.md`)
- **Netlify:** `netlify.toml` ships ready. User: connect the repo in the Netlify UI →
  you: tell them exactly which env vars to add (`ALCHEMY_API_KEY`, optional
  `ETHERSCAN_API_KEY`, `ROBINHOOD_RPC_URL`) → deploy → custom domain + DNS.
- **Vercel:** `vercel.json` ships ready; import the repo, same env vars, deploy.
- **Cloudflare:** Workers via OpenNext — `docs/HOSTING.md` has the exact commands;
  env vars become Worker secrets.
- **Other/self-host:** `npm run build && npm start` behind any reverse proxy.

### Stage 4 — verify live, then hand over
Fetch `https://<their-domain>/api/feed` — it must return `"mode":"live"` with a
`stats` object (null stats on the very first hit is a cold start; poll once more).
Walk the user through their site page by page, then tell them plainly: the site is
informational, revenue figures track third-party trading and can be zero, and their
RPC key should be domain-restricted in the Alchemy dashboard.

### Updating — when the user says "update my site" (you run all of it)
The user's identity lives in exactly two files the kit never needs back
(`site.config.json`, `.env.local` — one committed, one gitignored). Updates are a
merge where **theirs wins on identity, the kit wins everywhere else**:
```sh
git remote add upstream <public-kit-repo-url>   # once
git fetch upstream
git log --oneline HEAD..upstream/main           # tell the user what's new, briefly
git add site.config.json && git diff --cached --quiet || git commit -m "snapshot: site identity before kit update"
git merge upstream/main                         # conflicts: keep THEIRS for site.config.json, UPSTREAM for the rest
npm install
npm run doctor                                  # config + env + version check
npm run build                                   # must pass before any deploy
```
`npm run doctor` also self-reports when a newer release exists (it checks
`version.json`'s `updateManifestUrl`), so "is my site current?" is one command.

---

## What's inside
- `src/app/*` — the site (Next.js 16 App Router; every page reads the chain live).
- `create/` — this wizard (`index.mjs`) + AI-agent detection (`agents.mjs`).
- `/setup` — the in-browser studio for the same three values, with dev-mode Apply.
- `scripts/doctor.mjs` — config/env/update health check (`npm run doctor`).
- `docs/HOSTING.md` — per-platform deploy walkthroughs.
- `version.json` — the kit's release version + update manifest.

## Disclaimers
This software renders public on-chain data. It is not investment advice, and running
it makes you the operator of your own instance — see `DISCLAIMER.md`.
