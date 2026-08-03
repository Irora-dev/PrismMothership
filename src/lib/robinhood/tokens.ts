// The Robinhood Chain token registry for /robinhood — the chain's live meme
// tokens (addresses + brand accents + logos lifted from the SpecCont bento
// asset, logos served from /public/robinhood). ALPHABETICAL by symbol and kept
// that way everywhere: the page deliberately never ranks by TVL/liquidity/volume
// (ranking = preferential promotion). Market data is fetched live per request
// (/api/robinhood/tokens); nothing here is baked.

export interface RhToken {
  id: string;
  symbol: string;
  name: string;
  address: string;
  accent: string;
  logo: string;
}

export const RH_TOKENS: RhToken[] = [
  { id: "cashcat", symbol: "CASHCAT", name: "Cash Cat", address: "0x020bfc650a365f8bb26819deaabf3e21291018b4", accent: "#ffb224", logo: "/robinhood/cashcat.png" },
  { id: "dih", symbol: "DIH", name: "Dog In Hood", address: "0xd7321801caae694090694ff55a9323139f043b88", accent: "#a48bff", logo: "/robinhood/dih.png" },
  { id: "hoodrat", symbol: "HOODRAT", name: "Hoodrat", address: "0x17bb0c898254406b1ea2e8e99b0c263e26c9e4a4", accent: "#35e0ff", logo: "/robinhood/hoodrat.png" },
  { id: "juggernaut", symbol: "JUGGERNAUT", name: "The Juggernaut", address: "0x8e62f281f282686fca6dcb39288069a93fc23f1c", accent: "#ff4db8", logo: "/robinhood/juggernaut.png" },
  { id: "merryen", symbol: "MERRYMEN", name: "Merry Men", address: "0x5266eeaff092d6136ab63d18b975a60a0cc0c8f7", accent: "#fb7185", logo: "/robinhood/merryen.png" },
  { id: "repe", symbol: "REPE", name: "Robinhood Pepe", address: "0x10ae2f9345dd9c8bb0853971f41c9b4e9f9f3bf2", accent: "#4ade80", logo: "/robinhood/repe.png" },
];
