# Bot ⇄ Spectrum site — the integration contract

The Telegram bot and its cards run on **the Mothership deployment** (this kit —
e.g. `prismmothership.xyz`). Basket **execution** — choosing weights, naming,
signing — lives on **the Spectrum operator site** (`spectrumindexes.xyz`), a
different origin and a different repo.

Nothing here is a shared database. The two sides meet in exactly three places,
and each one degrades honestly if the other end isn't built yet.

## 1. Handoff — bot → Spectrum (needed; the flow 404s without it)

Every "make it real" path (`/launch`, `/createbasket`, `/split`, `/reweight`)
ends at one URL:

```
${SPECTRUM_CREATE_URL}?tokens=0xAAA…,0xBBB…&chain=eth|base
```

- `SPECTRUM_CREATE_URL` is set in the bot deployment's env and **must** point at
  the operator create page. Unset, the bot does not invent a URL — it says the
  operator hasn't wired the create page yet, and shows the composition anyway.
  (It used to default to `{site}/createbasket`, which this kit doesn't serve;
  the surface gate caught the 404.)
- `tokens` — comma-separated addresses, already validated by the bot (real,
  tradeable, liquid, all on one chain).
- `chain` — `eth` or `base`. Baskets are single-chain at the contract level.

**Ask of the Spectrum side:** read those two params and prefill the composer —
ideally equal weights — so the group's tap lands on a nearly-signed basket.
Optional but useful: accept `&ref=tg` and count it, so the funnel is measurable.

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
