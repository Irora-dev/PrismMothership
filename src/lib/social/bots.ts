// ── Two bots, one codebase ────────────────────────────────────────────────────
// the designer's ruling (2026-08-07): these are two different products and they should
// not be one bot.
//
//   PRISM bot — a helper for the Prism community. It keeps the room and its DMs
//     up to date with the ecosystem: price, supply, burn, revenue, links. It
//     reads and reports. Nothing it does depends on a wallet being linked.
//
//   SPECTRUM bot — part of the Spectrum suite. The product: baskets, group
//     drafting and launching, watchlists, the league, and the private portfolio
//     surface (link, positions, PnL, reweight, alerts, buy).
//
// Both run from this deployment because a bot is only an HTTPS endpoint, and
// both share every handler, store and card renderer below. What differs is
// identity: a token, a username, a menu, a brand, and a command set. Splitting
// on identity rather than on code means a command can only ever answer on the
// bot that owns it, and the other bot can say where it lives instead of playing
// dumb.

export type BotId = "prism" | "spectrum";

export interface Bot {
  id: BotId;
  /** how the bot introduces itself */
  name: string;
  /** one line: what this bot is for */
  purpose: string;
  /** env var holding its BotFather token */
  tokenEnv: string;
  /** env var holding its @username (no @) */
  usernameEnv: string;
  /** fallback username when the env var is unset */
  defaultUsername: string;
  /** env var holding its webhook secret */
  secretEnv: string;
  /** the path Telegram POSTs updates to */
  webhookPath: string;
  /** which brand its cards wear */
  brand: "prism" | "spectrum";
}

export const BOTS: Record<BotId, Bot> = {
  prism: {
    id: "prism",
    name: "Spectra · Prism Bot",
    purpose: "Live eyes on the Prism ecosystem",
    tokenEnv: "TELEGRAM_BOT_TOKEN",
    usernameEnv: "TELEGRAM_BOT_USERNAME",
    defaultUsername: "SpectraPrismBot",
    secretEnv: "TELEGRAM_WEBHOOK_SECRET",
    // unchanged: the live webhook already points here, and moving it would take
    // the community bot down for as long as the change took to notice
    webhookPath: "/api/telegram/webhook",
    brand: "prism",
  },
  spectrum: {
    id: "spectrum",
    name: "Spectrum Bot",
    purpose: "Baskets, groups and your portfolio",
    tokenEnv: "SPECTRUM_BOT_TOKEN",
    usernameEnv: "SPECTRUM_BOT_USERNAME",
    // the real handle, confirmed from getMe on 2026-08-07 (SPECTRUM_BOT_USERNAME
    // still overrides it, but the fallback should not be a guess)
    defaultUsername: "spectrum_tgbot",
    secretEnv: "SPECTRUM_WEBHOOK_SECRET",
    webhookPath: "/api/telegram/spectrum",
    brand: "spectrum",
  },
};

export const DEFAULT_BOT: BotId = "prism";

export const botToken = (bot: BotId = DEFAULT_BOT): string | undefined => process.env[BOTS[bot].tokenEnv];
export const botUsername = (bot: BotId = DEFAULT_BOT): string => process.env[BOTS[bot].usernameEnv] || BOTS[bot].defaultUsername;
export const botSecret = (bot: BotId = DEFAULT_BOT): string | undefined => process.env[BOTS[bot].secretEnv];
/** A bot with no token cannot send anything, so its surfaces stay dark. */
export const botLive = (bot: BotId): boolean => Boolean(botToken(bot));

// ── The partition ─────────────────────────────────────────────────────────────
// Every command belongs to exactly one bot. Read-only ecosystem facts are the
// Prism bot's whole job; anything that touches a basket, a group's shared state
// or someone's own wallet is the Spectrum product.

/** Ecosystem reporting: what PRISM is worth, what has burned, where to look. */
const PRISM_COMMANDS = [
  "start", "help",
  "price", "supply", "burn", "bigburn", "prism", "earned", "apy", "quote", "wallet",
  "ca", "contract", "links", "socials",
  "lightrunner", "game",
];

/** The Spectrum suite: baskets, group tools, and the private portfolio. */
const SPECTRUM_COMMANDS = [
  "start", "help",
  // baskets, as objects you act on
  "baskets", "basket", "leaderboard", "top", "token", "ti", "split", "portfolio", "spectrumportfolio", "portfoliostats",
  // the group's shared basket
  "createbasket", "draft", "propose", "vote", "drop", "launch", "cleardraft",
  "ourbasket", "mybasket", "watch", "unwatch", "watchlist", "wl", "league",
  // your own book, private
  "link", "unlink", "me", "myportfolio", "pnl", "reweight", "alerts", "buy",
];

const OWNS: Record<BotId, Set<string>> = {
  prism: new Set(PRISM_COMMANDS),
  spectrum: new Set(SPECTRUM_COMMANDS),
};

/**
 * ── THE SPLIT IS DORMANT UNTIL THE SPECTRUM BOT IS ARMED ────────────────────
 * the designer, 2026-08-07: the Spectrum bot stays **private until we're ready to ship
 * it**, and it must not go out with the next Spectrum update.
 *
 * The code ships either way, because it lives in the same tree. So the split has
 * to be inert on arrival rather than merely unconfigured, for two reasons:
 *
 *   1. It would ADVERTISE an unshipped product. A user asking the Prism bot for
 *      /baskets would be told it "lives with the Spectrum Bot" and handed the
 *      @handle of something that does not exist yet.
 *   2. It would BREAK the live bot. /baskets, /ourbasket and /league answer on
 *      the Prism bot today; partitioning them away without a Spectrum bot to
 *      receive them turns working commands into pointers at nothing.
 *
 * Dormant behaviour is therefore "exactly the single bot we had before": the
 * Prism bot owns every command, and nothing mentions a Spectrum bot at all.
 * Arming is the presence of SPECTRUM_BOT_TOKEN, which the operator sets when the
 * system is ready, and the partition takes effect on its own at that moment.
 */
export const splitArmed = (): boolean => botLive("spectrum");

export const ownsCommand = (bot: BotId, cmd: string): boolean => {
  const c = cmd.toLowerCase();
  // dormant: the Prism bot answers everything, as it did before the split
  if (!splitArmed()) return bot === "prism" ? OWNS.prism.has(c) || OWNS.spectrum.has(c) : false;
  return OWNS[bot].has(c);
};

/** Which bot owns a command, if any. Used to point a user at the right one. */
export function ownerOf(cmd: string): BotId | null {
  if (!splitArmed()) return null; // dormant: never name a bot that is not shipped
  const c = cmd.toLowerCase();
  if (OWNS.spectrum.has(c) && !OWNS.prism.has(c)) return "spectrum";
  if (OWNS.prism.has(c) && !OWNS.spectrum.has(c)) return "prism";
  return null; // shared (start/help) or unknown
}

/**
 * What to say when someone uses a command on the wrong bot. Never "I don't know
 * that": the command exists, it just lives next door, and the other bot might
 * not be running yet.
 */
export function elsewhereText(cmd: string, other: BotId): string {
  const u = botUsername(other);
  const b = BOTS[other];
  if (!botLive(other)) {
    return [
      `That one belongs to the <b>${b.name}</b>, which isn't running yet.`,
      "",
      `<i>${b.purpose}.</i>`,
    ].join("\n");
  }
  return [
    `<code>/${cmd}</code> lives with the <b>${b.name}</b>.`,
    "",
    `<i>${b.purpose}.</i>`,
    "",
    `<a href="https://t.me/${u}">Open @${u} →</a>`,
  ].join("\n");
}
