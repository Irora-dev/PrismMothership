import type { Metadata } from "next";
import Link from "next/link";
import { AnimatedBg } from "@/components/effects/animated-bg";
import { TopNav } from "@/components/layout/top-nav";

export const metadata: Metadata = {
  title: "Privacy notice · The Prism Mothership",
  description:
    "The Prism Mothership is a read-only informational dashboard. No accounts, no analytics, no tracking cookies. This notice explains the limited data involved when you visit.",
};

// NOTE: Working draft of the privacy notice, written to match the site's actual
// data practices (no accounts, no analytics, self-hosted fonts, server-side RPC).
// Before publishing: set a working privacy contact email below and confirm no
// analytics or tracking has been added since. A registered company name or postal
// address is not required for this notice; naming who operates the site is optional.

interface Section {
  h: string;
  body: React.ReactNode;
}

const UPDATED = "June 2026";
const CONTACT = "privacy@prismbeat.xyz";

const SECTIONS: Section[] = [
  {
    h: "1. What this notice covers",
    body: (
      <>
        The Prism Mothership is an informational dashboard that displays public, on-chain activity. There are no
        accounts, no sign-up, and no login. This notice explains the limited personal data involved when
        you visit the site, how it is used, and the rights you have under the EU General Data Protection
        Regulation (GDPR).
      </>
    ),
  },
  {
    h: "2. Who is responsible",
    body: (
      <>
        The operator of this site is the controller for the personal data described here. For any privacy
        question, or to exercise your rights, contact{" "}
        <a href={`mailto:${CONTACT}`} className="text-slate-300 underline underline-offset-2">
          {CONTACT}
        </a>
        .
      </>
    ),
  },
  {
    h: "3. No accounts, no tracking",
    body: (
      <>
        We do not ask you to register or to connect a wallet, and we do not use analytics, advertising,
        tracking pixels, or third-party tracking cookies. We do not build profiles of visitors, and we do
        not sell or share personal data for marketing.
      </>
    ),
  },
  {
    h: "4. What is processed when you visit",
    body: (
      <>
        Like any website, our hosting provider records standard server logs when a page is requested. These
        may include your IP address, the pages requested, timestamps, and basic device or browser
        information. We process this only to operate, secure, and debug the site, on the basis of our
        legitimate interests (GDPR Article 6(1)(f)), and we retain it only as long as needed for those
        purposes.
      </>
    ),
  },
  {
    h: "5. Browser storage",
    body: (
      <>
        The Prism Mothership stores a small amount of data in your browser to make the site work, such as interface
        preferences and display values. This storage is strictly necessary, stays on your device, is not
        used to track you, and is not shared. Because we set no non-essential or tracking cookies, the site
        does not show a cookie-consent banner.
      </>
    ),
  },
  {
    h: "6. Self-hosted assets",
    body: (
      <>
        We serve our fonts and other assets from our own domain rather than from third-party content
        networks. As a result, simply loading The Prism Mothership does not transmit your data to outside services such
        as font providers.
      </>
    ),
  },
  {
    h: "7. Service providers and on-chain data",
    body: (
      <>
        Our hosting provider processes server logs on our behalf under appropriate terms. On-chain data is
        read through our own backend, so your IP address is not shared with blockchain RPC providers when you
        browse. Wallet addresses, transactions, and balances shown on the site are public blockchain data;
        they are not collected from you. Links to third-party sites, such as a token explorer or exchange,
        are governed by those sites&apos; own policies.
      </>
    ),
  },
  {
    h: "8. International transfers",
    body: (
      <>
        Where a service provider processes data outside the European Economic Area, we rely on appropriate
        safeguards, such as the European Commission&apos;s standard contractual clauses.
      </>
    ),
  },
  {
    h: "9. Your rights",
    body: (
      <>
        Under the GDPR you may request access to your personal data, and its rectification or erasure, and
        you may restrict or object to its processing, subject to legal limits. To make a request, contact{" "}
        <a href={`mailto:${CONTACT}`} className="text-slate-300 underline underline-offset-2">
          {CONTACT}
        </a>
        . You also have the right to lodge a complaint with the Maltese supervisory authority, the
        Information and Data Protection Commissioner (idpc.org.mt).
      </>
    ),
  },
  {
    h: "10. Changes to this notice",
    body: (
      <>
        We may update this notice from time to time. Any changes take effect when published on this page.
        Your continued use of the site after a change is published constitutes acceptance of the updated
        notice.
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <div className="spectrum-root relative min-h-screen">
      <AnimatedBg variant="circle" darkOpaque rainbow edgesOnly zIndex={0} fadeInDelayMs={200} />
      <TopNav />

      <main className="relative z-10 mx-auto max-w-[820px] px-5 md:px-6 pt-12 md:pt-16 pb-28">
        {/* hero */}
        <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 mb-5 text-[11px] font-bold uppercase tracking-[0.2em] border border-white/10 bg-white/5">
          <span className="text-slate-300">Privacy</span>
        </div>
        <div className="flex w-fit flex-col items-start">
          <h1 className="logo-font spectrum-title text-5xl md:text-7xl font-bold tracking-tighter txt-white leading-none">
            Privacy notice
          </h1>
          <div className="spectrum-divider w-full mt-3" />
        </div>
        <p className="mt-5 text-base md:text-lg text-slate-300 leading-relaxed max-w-2xl">
          The Prism Mothership is a read-only dashboard. No accounts, no analytics, no tracking cookies. Here is the
          limited data involved when you visit, and what you can do about it.
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
            See also our{" "}
            <Link href="/legal" className="text-slate-400 hover:text-white underline underline-offset-2">
              Legal &amp; disclaimers
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
