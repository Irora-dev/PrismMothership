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

The kit ships ready for the OpenNext adapter (`wrangler.jsonc` +
`open-next.config.ts` are in the repo), so the whole deploy is:
```sh
npm install --save-dev @opennextjs/cloudflare wrangler
npx opennextjs-cloudflare build
npx wrangler deploy                          # log in when prompted
npx wrangler secret put ALCHEMY_API_KEY      # repeat for the optional vars
```
Then point your domain at the Worker (dashboard → Workers → your worker →
Domains & Routes — one click if your DNS is already on Cloudflare).

**Prefer push-to-deploy instead of the CLI?** In the dashboard, create a Worker by
importing your GitHub repo (Workers Builds): build command
`npx opennextjs-cloudflare build`, deploy command `npx wrangler deploy`, and add the
env vars under the worker's Settings → Variables and Secrets. Every push deploys,
like Pages did.

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
