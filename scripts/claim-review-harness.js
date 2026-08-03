// Wallet review harness — renders /claim CONNECTED as a real holder wallet,
// headless. Announces a fake EIP-6963 provider ("ReviewWallet") that answers
// only accounts/chainId; all data still comes from the page's own server API.
// Scoped to MAIN: the global menu also has a Connect button, and clicking that
// one connects the shell chip while the page's local flow stays disconnected
// (exactly what a stray byText("connect") did — 2026-08-03).
// Usage: node scripts/mshot.mjs http://localhost:3588/claim out.png 1440 1700 "$(cat scripts/claim-review-harness.js)"
(async () => {
  const W = "0x38C009b2961842340b1E8c90DC6223bCF5795B4a";
  const provider = {
    request: async ({ method }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [W];
      if (method === "eth_chainId") return "0x1";
      if (method === "net_version") return "1";
      throw new Error("review harness: " + method);
    },
    on: () => {}, removeListener: () => {},
  };
  const detail = Object.freeze({
    info: Object.freeze({ uuid: "review-0000-0000", name: "ReviewWallet", icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", rdns: "dev.review" }),
    provider,
  });
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
  await new Promise((r) => setTimeout(r, 400));
  const byText = (root, t) => [...root.querySelectorAll("button")].find((b) => b.textContent.toLowerCase().includes(t));
  byText(document.querySelector("main") ?? document, "connect wallet")?.click();
  await new Promise((r) => setTimeout(r, 700));
  byText(document, "reviewwallet")?.click();
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const t = document.body.textContent;
    if (t.includes("Your fees") || /Claim all|Claim \d+ selected|Withdraw/.test(t)) break;
  }
  await new Promise((r) => setTimeout(r, 1500));
  return /Claim all|Withdraw/.test(document.body.textContent) ? "connected + money card visible" : "connected (check)";
})()