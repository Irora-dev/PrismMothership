import type { Metadata } from "next";
import Link from "next/link";
import { AnimatedBg } from "@/components/effects/animated-bg";
import { TopNav } from "@/components/layout/top-nav";

export const metadata: Metadata = {
  title: "Legal & disclaimers · Prismbeat",
  description:
    "Prismbeat is an informational dashboard that displays public on-chain activity. It is not investment advice, an offer, or a solicitation.",
};

// NOTE: This is a working draft of the legal / disclaimer copy, written to match
// the disclaimers already shown in the site footer and on the dashboard. It is a
// starting point for the operator to review and finalize (ideally with counsel)
// — replace or extend any section below as needed.

interface Section {
  h: string;
  body: React.ReactNode;
}

const UPDATED = "June 2026";

const SECTIONS: Section[] = [
  {
    h: "1. Informational purpose only",
    body: (
      <>
        Prismbeat is an informational dashboard that displays public, on-chain activity relating to the
        Prism token and connected protocols. It exists to make publicly available blockchain data easier
        to read. Everything shown here is provided for general information only and does not take account
        of your objectives, financial situation, or needs.
      </>
    ),
  },
  {
    h: "2. Not investment advice",
    body: (
      <>
        Nothing on this site is, or should be construed as, investment, financial, legal, accounting, or
        tax advice, or a recommendation to buy, sell, hold, or transact in any token, asset, or strategy.
        No content here is a forecast, a promise, or a guarantee of any outcome. You are solely responsible
        for your own decisions and should obtain independent professional advice before acting.
      </>
    ),
  },
  {
    h: "3. No offer or solicitation",
    body: (
      <>
        Nothing on this site constitutes an offer, solicitation, or invitation to buy or sell any token or
        security, or to participate in any transaction, in any jurisdiction where such an offer or
        solicitation would be unlawful. Access may be restricted in certain jurisdictions; it is your
        responsibility to ensure your use of the site complies with the laws that apply to you.
      </>
    ),
  },
  {
    h: "4. No affiliation or endorsement",
    body: (
      <>
        Prismbeat is an independent dashboard. It is not affiliated with, sponsored by, or endorsed by
        Prism, Spectrum, Uniswap, or any of the tokens, protocols, or projects whose data may be
        displayed, and it does not endorse any of them. All product names, logos, and trademarks belong to
        their respective owners and are used for identification only.
      </>
    ),
  },
  {
    h: "5. Data may be inaccurate or delayed",
    body: (
      <>
        On-chain and market data is gathered from third-party sources, public RPC providers, and indexers,
        and is shown on an &ldquo;as-is&rdquo; basis. It may be incomplete, delayed, cached, mis-decoded, or
        wrong. Figures such as revenue, burns, prices, and index valuations are estimates derived from
        public data and should not be relied upon. Always verify directly against the underlying blockchain
        and contracts before acting on anything you see here.
      </>
    ),
  },
  {
    h: "6. Risk of digital assets",
    body: (
      <>
        Digital assets are highly volatile and speculative, and carry significant risk including the total
        loss of value. Smart contracts may contain bugs or vulnerabilities, may be exploited, and may behave
        unexpectedly. Past activity is not indicative of future results. You should never transact with funds
        you cannot afford to lose.
      </>
    ),
  },
  {
    h: "7. Third-party links and content",
    body: (
      <>
        This site links to and may embed third-party websites, applications, and content. Those resources
        are outside our control, and we are not responsible for their accuracy, availability, security, or
        practices. Links and embeds are provided for convenience and do not imply any endorsement.
      </>
    ),
  },
  {
    h: "8. No warranty; limitation of liability",
    body: (
      <>
        The site is provided &ldquo;as is&rdquo; and &ldquo;as available,&rdquo; without warranties of any
        kind, whether express or implied, including fitness for a particular purpose and accuracy. To the
        fullest extent permitted by law, the operators of this site accept no liability for any loss or
        damage arising out of or in connection with your use of, or reliance on, the site or its content.
      </>
    ),
  },
  {
    h: "9. Changes to this notice",
    body: (
      <>
        We may update this notice from time to time. Any changes take effect when published on this page.
        Your continued use of the site after a change is published constitutes acceptance of the updated
        notice.
      </>
    ),
  },
];

export default function LegalPage() {
  return (
    <div className="spectrum-root relative min-h-screen">
      <AnimatedBg variant="circle" darkOpaque rainbow edgesOnly zIndex={0} fadeInDelayMs={200} />
      <TopNav />

      <main className="relative z-10 mx-auto max-w-[820px] px-5 md:px-6 pt-12 md:pt-16 pb-28">
        {/* hero */}
        <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 mb-5 text-[11px] font-bold uppercase tracking-[0.2em] border border-white/10 bg-white/5">
          <span className="text-slate-300">Legal · Disclaimers</span>
        </div>
        <div className="flex w-fit flex-col items-start">
          <h1 className="logo-font spectrum-title text-5xl md:text-7xl font-bold tracking-tighter txt-white leading-none">
            Legal &amp; disclaimers
          </h1>
          <div className="spectrum-divider w-full mt-3" />
        </div>
        <p className="mt-5 text-base md:text-lg text-slate-300 leading-relaxed max-w-2xl">
          Prismbeat is an informational dashboard that displays public on-chain activity. Please read these
          disclaimers carefully before using the site.
        </p>
        <p className="mt-2 text-[12px] uppercase tracking-[0.2em] text-slate-500 font-semibold">
          Last updated · {UPDATED}
        </p>

        {/* sections */}
        <div className="mt-10 space-y-8">
          {SECTIONS.map((s) => (
            <section key={s.h}>
              <h2 className="text-lg md:text-xl font-bold txt-white mb-2">{s.h}</h2>
              <p className="text-[14px] md:text-[15px] text-slate-400 leading-relaxed">{s.body}</p>
            </section>
          ))}
        </div>

        {/* footer */}
        <footer className="mt-14 pt-8 border-t border-white/10 text-[12px] text-slate-500 leading-relaxed">
          <p>
            By using Prismbeat you acknowledge that you have read and understood these disclaimers. See also
            our{" "}
            <Link href="/privacy" className="text-slate-400 hover:text-white underline underline-offset-2">
              Privacy notice
            </Link>
            , or go{" "}
            <Link href="/" className="text-slate-400 hover:text-white underline underline-offset-2">
              back to the dashboard
            </Link>
            .
          </p>
        </footer>
      </main>
    </div>
  );
}
