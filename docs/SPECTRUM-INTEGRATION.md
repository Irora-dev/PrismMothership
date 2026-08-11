# Bot ⇄ Spectrum site — the integration contract

## Two bots, not one *(ruled by the designer, 2026-08-07)*

There are **two Telegram bots**, because they are two products:

| | **Prism bot** | **Spectrum bot** |
|---|---|---|
| what it is | a helper for the Prism community | part of the Spectrum suite |
| what it does | keeps the room and its DMs up to date with the ecosystem: price, supply, burn, revenue, links | baskets, group drafting and launching, watchlists, the league, and the private portfolio surface |
| webhook | `/api/telegram/webhook` | `/api/telegram/spectrum` |
| token · username · secret | `TELEGRAM_BOT_TOKEN` · `TELEGRAM_BOT_USERNAME` · `TELEGRAM_WEBHOOK_SECRET` | `SPECTRUM_BOT_TOKEN` · `SPECTRUM_BOT_USERNAME` · `SPECTRUM_WEBHOOK_SECRET` |
| brand on its cards | the Prism pixel mark | the Spectrum wordmark |
| menu | `node scripts/telegram-commands.mjs --bot prism` | `… --bot spectrum` |

### Where they are hosted *(corrected by the designer, 2026-08-07)*

**We do not host these sites; the community member does.** The intended homes:

| | serves the site | serves the bot's webhook | status |
|---|---|---|---|
| Prism bot | `prismmothership.xyz` (community) | there today; `prismmothership.com` (ours) is an option | live |
| Spectrum bot | `spectrumindexes.xyz` (community) | **not possible there yet, see below** | held back |

⚠️ **`spectrumindexes.xyz` cannot serve a webhook as it stands.** Probed 2026-08-07:
it is a pure Vite SPA with a catch-all redirect, so *every* path returns
`index.html` with a 200, including `/api/feed` and `/.netlify/functions/`. The
Spectrum kit ships no `netlify/functions` directory, only one OG edge function.
A Telegram webhook needs a real POST endpoint, so putting the bot's *endpoint*
there means adding serverless functions to that kit and porting the handlers, the
Blobs-backed stores and the Satori card renderer into it.

Worth separating two readings of "under the Spectrum site", because they differ by
an order of magnitude in cost:

- **Users perceive it as a Spectrum product.** Already true and needs nothing: the
  @handle, name, menu and card branding are all Spectrum. A webhook URL is
  invisible to users.
- **The HTTP endpoint physically lives on that domain.** A port of the whole bot
  backend into a repo that currently has no backend.

🔒 **The split ships DORMANT.** the designer: the Spectrum bot stays private until we are
ready, and must not go out with the next Spectrum update. With
`SPECTRUM_BOT_TOKEN` unset the live bot behaves exactly as the single bot did and
**nothing anywhere names a Spectrum bot** (asserted by gate ④c-4). Arming is the
presence of that one env var. See `splitArmed()` in `src/lib/social/bots.ts`.

Both run from **one** deployment, because a bot is only an HTTPS endpoint, and
both share every handler, store and card renderer. Only identity differs: a
token, a username, a menu, a brand, and a command set. The partition lives in
`src/lib/social/bots.ts` and is **enforced at dispatch**, so a command answers
only on the bot that owns it. On the other bot it says where it lives rather than
playing dumb, and if that bot has no token yet it says that instead of pointing
at a dead handle. With `SPECTRUM_BOT_TOKEN` unset the whole Spectrum surface
stays dark, so the split ships safe.

Everything below is about the **Spectrum bot's** relationship with the operator
site; the Prism bot has no seam with it at all.

---

The Telegram bot and its cards run on **the Mothership deployment** (this kit —
e.g. `prismmothership.xyz`). Basket **execution** — choosing weights, naming,
signing — lives on **the Spectrum operator site** (`spectrumindexes.xyz`), a
different origin and a different repo.

Nothing here is a shared database. The two sides meet in exactly three places,
and each one degrades honestly if the other end isn't built yet.

**See it running:** `/dev/telegram` (dev only) has a **Seam map** panel on the
right. It renders `src/lib/social/seams.ts` — the machine-readable version of
this document — with the live wiring state read from the deployment's own env, so
an unwired seam says `unwired` instead of reading as finished. Underneath it,
every link the bot hands out during a session is logged and attributed to the
side that has to serve it. This document explains *why* each seam is shaped the
way it is; that panel is *what is true right now*. Add a seam to `seams.ts` and a
section here at the same time.

## 1. Handoff · bot → Spectrum (built and verified; needs one env var)

Every "make it real" path (`/launch`, `/createbasket`, `/split`, `/reweight`)
ends at one URL:

```
${SPECTRUM_CREATE_URL}?tokens=0xAAA…,0xBBB…&chain=eth|base[&weights=60,40]
```

**Verified end to end on 2026-08-07**, by following a real `/split` link from the
bot into a running Composer: the assets seed with live logos and a backtest, the
chain switches, and the launch flow opens prefilled. Two things that verification
found, both now fixed:

- **The create page already exists.** It is `/createbasket` in the **Spectrum kit**
  (`app/src/pages/Composer.tsx`), not a page anyone still needs to build. What was
  missing was only the env var pointing at it. Set `SPECTRUM_CREATE_URL` to the
  operator's own kit deployment, e.g. `https://<their-domain>/createbasket`.
- 🔴 **`weights` did not exist, and the split was being silently discarded.** The bot
  said "60% PEPE, 40% MOG" and the create page seeded 50/50, because only
  `tokens` and `chain` crossed the seam. Both sides now carry `weights`.

- `SPECTRUM_CREATE_URL` is set in the bot deployment's env and points at the
  operator's create page. Unset, the bot invents no URL: it says this operator
  has not pointed it at their create page yet, and shows the composition anyway.
  (It used to default to `{site}/createbasket`, which the *Mothership* does not
  serve; the surface gate caught that 404. The page lives in the Spectrum kit.)
- `tokens` — comma-separated addresses, already validated by the bot (real,
  tradeable, liquid, all on one chain).
- `chain` — `eth` or `base`. Baskets are single-chain at the contract level. The
  Composer also accepts `ethereum`, `mainnet`, or a numeric chain id.
- `weights` — **optional**, comma-separated, positionally aligned to `tokens`, and
  normalised to 100 on arrival. Sent whenever the group actually agreed a split
  (`/split`); omitted otherwise, which the Composer reads as equal weight. If a
  token is dropped for not being tradeable on the chain, the Composer falls back
  to equal weight across the survivors rather than applying a partial split, and
  says which token it skipped.

**Nothing further is asked of the Spectrum side for this seam.** It is built and
verified. The one outstanding nice-to-have is `&ref=tg&draft=<id>` echo, which
turns launch attribution from inferred into exact (see §3).

## 2. Wallet linking — either surface (built, cross-origin ready)

A member links a wallet once, then reads their positions in the bot's DM.

- **Bot-first (works today):** `/link` in a DM mints a 6-character code and
  sends `{mothership}/link?code=ABC123`. That page connects the wallet and
  POSTs the claim. No Spectrum involvement.
- **Spectrum-first (open, nothing needed from us):** the operator site can offer
  "Link Telegram" for a visitor who already has a wallet connected — collect the
  code from the user and POST it:

```
POST {mothership}/api/link      { "code": "ABC123", "address": "0x…" }
→ 200 { ok: true } | 410 { ok:false, error } (expired / already used)
```

`Access-Control-Allow-Origin` is granted to `https://spectrumindexes.xyz` by
default; `LINK_ALLOWED_ORIGINS` (comma-separated) overrides it. Codes are
single-use and expire in 20 minutes.

The link is **read-only**: it lets a Telegram account see that address's public
positions. It is not an approval, grants no spending rights, and the bot never
signs anything.

## 3. Launch attribution — how a group learns its basket went live

Today this is inferred: the bot watches launch events and matches a new
basket's composition against groups' open drafts (overlap ≥2 and ≥ draft−1,
because the create page may drop a token). It works, but it is a heuristic.

**Ask of the Spectrum side (nice-to-have):** if the create page received
`&ref=tg&draft=<id>`, echo that id back — either in the launch call or by
POSTing `{mothership}/api/tg/launched` — and attribution becomes exact rather
than inferred.

## What is NOT possible on-chain today (verified, not assumed)

A deployed basket's composition is **immutable**. Probing a live basket's
bytecode finds no `setWeights`, `setTargetWeights`, `rebalance`, `addAsset`,
`removeAsset`, `setComposition`, `owner` or `creator` — only
`setMetadata(string,string)`. The factory says so itself: *"no registry, no
curator, no successor pointer — protocol versioning = a new factory address +
social convention."*

So:

- **A member reweighting their own holdings** = trading into the new shape.
  That is what `/reweight` produces: a target plus the page to sign it.
- **A group changing its basket** = launching a **new version** and pointing the
  old one at it socially. The bot's group registry is the natural home for that
  lineage (v1 → v2), since the chain deliberately keeps no pointer.

If the next contract revision wants to support in-place governance, the
capability the bot flow needs is: an authorised weight update on a live basket
(creator- or vote-gated), emitting an event the site can index. Until then, the
new-version path above is the honest one — and it is worth designing the
lineage fields into the bot's registry now so the migration reads as continuity
rather than a fresh start.

---

## The surface gate (`npm run verify`)

Every change to these surfaces runs through `scripts/verify.mjs` before it can
be released. It exercises the running app rather than the source, because every
bug that reached a user here passed the typechecker:

| what it asserts | the bug it would have caught |
|---|---|
| every page + `/api/feed` respond | a route dying on deploy |
| every card renders, above a per-kind byte floor | Satori silently dropping webp art (a 105KB empty frame vs 590KB real one) |
| param-driven cards produce **different bytes for different inputs** | a card ignoring its data and rendering the same frame forever |
| every command answers, with no `undefined` / `NaN` / `$0.00` / escaped tags | a formatter printing a sub-cent token as `$0.00`; an un-escape leaving literal `<b>` |
| DM-only commands refuse in groups | a wallet address leaking into a group chat |
| **every URL the bot emits resolves** | a launch button pointing at a page that does not exist |

It runs as gate 2b of `release/release.mjs` — the release boots the built app
and fails if anything is broken. `--skip-verify` exists but wants a reason.

Two notes from building it. The gate found two bugs *in itself* on its first
run (`$0.00` substring-matching the legitimate `$0.00000282`, and the bot's own
absolute URLs reading as third-party), which is the expected shape of a new
gate — tune the assertions until every failure is a real one, then trust it.
And its first true finding was the create-page 404, which is why the bot now
declines to hand out a link when `SPECTRUM_CREATE_URL` is unset instead of
inventing one.
