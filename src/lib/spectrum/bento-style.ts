// ── The bento tile treatment, single-sourced ─────────────────────────────────
// FIVE renderers draw "the same" bento (the live BasketBento, the Satori card
// route, the studio social card, the studio basket share card, the robinhood
// MiniBento) and each restated the weight exponent and the inset treatment.
// They had already drifted: the social card ran 0.28/-6px/14px where the card
// route ran 0.30/-5px/12px. The renderers stay medium-specific by design —
// Satori JSX, live DOM and export DOM cannot share components — but the
// NUMBERS that make their tiles read as one family live here and only here.
// (The layout math and the brand colors were already shared: squarify +
// tokenVisual. This closes the last drift vector.)

// Tile AREA scales by weight^BENTO_SIZE_EXP (< 1) so a dominant holding does
// not swallow the box and the long tail stays legible. Labels always show the
// TRUE weight.
export const BENTO_SIZE_EXP = 0.65;
export const bentoWeight = (pct: number) => Math.pow(Math.max(pct, 0), BENTO_SIZE_EXP);

// The 3D-tile inset: top light, bottom shade. Two legitimate scales — "lg"
// for card-size tiles (the export cards, the Satori route), "sm" for live
// page tiles.
export const TILE_INSET = {
  lg: "inset 0 2px 0 rgba(255,255,255,0.30), inset 0 -5px 12px rgba(0,0,0,0.22)",
  sm: "inset 0 1px 0 rgba(255,255,255,0.30), inset 0 -3px 7px rgba(0,0,0,0.22)",
} as const;
