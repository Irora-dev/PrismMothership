# Hosting the Mothership

The site is a standard Next.js 16 App Router app: static pages + serverless API
routes. Any platform that runs Next runs it. Whichever host you pick, production
config is the same three env vars, set in the **host's dashboard** (never committed):

| var | required | what |
|---|---|---|
| `ALCHEMY_API_KEY` | yes | Ethereum mainnet reads (server-side only) |
| `ROBINHOOD_RPC_URL` | no | defaults to the public Robinhood Chain RPC |
| `ETHERSCAN_API_KEY` | no | live contract-verification badges |
| `URL` | recommended | your canonical https URL (share images) — most hosts set it automatically |

## Netlify (first-class — the reference deploy)
1. Push your fork/clone to GitHub, then Netlify → **Add new site → Import**.
2. Build settings are read from `netlify.toml` (ships in the repo) — accept them.
3. Site settings → Environment variables → add the table above.
4. Deploy, then Domain settings → add your custom domain and follow the DNS prompt.

## Vercel (native Next)
1. Vercel → **Add New → Project → Import** the repo. `vercel.json` ships in the repo.
2. Project → Settings → Environment Variables → add the table above.
3. Deploy; add your domain under Project → Domains.

## Cloudflare (Workers, via OpenNext)

> **Looking for Cloudflare *Pages*?** Use Workers instead — it is Cloudflare's own
> current path for full Next.js apps. Pages' Next support (`next-on-pages`) runs the
> edge runtime only, and this kit's API routes need the Node runtime, so they won't
> run there. Workers gives you the same domain/DNS experience, and you can keep the
> Pages-style push-to-deploy workflow (below).

**Easiest — the Deploy to Cloudflare button** (top of the README, or
[deploy.workers.cloudflare.com/?url=…PrismMothership](https://deploy.workers.cloudflare.com/?url=https://github.com/Irora-dev/PrismMothership)):
it copies the repo into your GitHub, wires build-on-push, prompts for variables
(`ALCHEMY_API_KEY`, `URL`), and deploys. Then attach your domain under the worker's
Domains & Routes.

The kit ships fully wired for Workers (`wrangler.jsonc` carries the build command,
the adapter is a devDependency), so **the whole CLI deploy is one command**:
```sh
npm install
npm run deploy                               # OpenNext build + wrangler deploy (log in when prompted)
npx wrangler secret put ALCHEMY_API_KEY      # repeat for the optional vars
```
(`npm run preview` = the same build served locally on the Workers runtime.)

**Fully headless — one API token drives everything (the AI-agent path).** One
dashboard visit, ever: **My Profile → API Tokens → Create Token → "Edit Cloudflare
Workers" template** (it carries the Worker-script, secret, and zone Workers-Routes
permissions this flow needs). Then, no browser at any step:
```sh
export CLOUDFLARE_API_TOKEN=<the token>
export CLOUDFLARE_ACCOUNT_ID=<account id>       # only needed on multi-account tokens
npm install && npm run deploy                    # build + create the worker, headless
printf '%s' "<alchemy-key>" | npx wrangler secret put ALCHEMY_API_KEY   # applies live, no redeploy
```
Custom domain by API (zone id is on the domain's dashboard Overview):
```sh
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/domains" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" \
  --data '{"hostname":"<your-domain>","service":"prism-mothership","environment":"production","zone_id":"<zone-id>"}'
```
(If that call 403s, add `Zone → DNS → Edit` to the token.) Two notes: the token can
edit every Worker on the account — treat it like a password and revoke it when done;
and this path deploys from wherever the CLI runs — the git push-to-deploy wiring
(Workers Builds) still needs the one-time dashboard repo import, so headless
redeploys are simply `npm run deploy` again.

**Push-to-deploy from the dashboard** (if you skipped the button): create a Worker by
importing your GitHub repo (Workers Builds) — deploy command `npx wrangler deploy`
is enough (the build command in `wrangler.jsonc` runs the OpenNext build for it),
and add the env vars under the worker's Settings → Variables and Secrets. Every push
deploys, like Pages did.

Two notes: the **paid Workers plan (~$5/mo)** is recommended — the free tier's CPU
budget is tight for the kit's cold chain scans. Blob-cache features degrade
gracefully off-Netlify: the site rebuilds its chain caches in memory per instance.

## Self-host
```sh
npm ci && npm run build
ALCHEMY_API_KEY=<key> npm start        # serves on :3090 — reverse-proxy it
```

## After any deploy
`https://<your-domain>/api/feed` must return `"mode":"live"` — if `stats` is null on
the very first hit, that's the cold chain scan; poll once more. `npm run doctor`
locally checks config, env hygiene, and whether a newer kit release exists.
