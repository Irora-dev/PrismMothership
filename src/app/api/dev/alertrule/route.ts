import { NextResponse } from "next/server";
import { claimWorthSaying } from "@/lib/social/alerts";

// ── The claim-nudge restraint rule, exposed for the gate (DEV ONLY) ──────────
// The rule is pure and it is the whole design of the nudge: claimable fees are a
// standing balance, so "over the floor" stays true forever once true, and a naive
// rule would tap the user on the shoulder twice a day until they claimed out of
// irritation. This replays a real accrual curve so the release gate can assert
// the restraint rather than trusting that it still holds.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "not found" }, { status: 404 });
  const FLOOR = 25;
  // a wallet's fees accruing over weeks, then a claim, then accruing again
  const curve = [0.4, 12, 26, 30, 38, 39, 45, 0.2, 20, 27];
  let nudgedAt: number | undefined;
  const steps = curve.map((usd) => {
    const fired = claimWorthSaying(usd, FLOOR, nudgedAt);
    if (fired) nudgedAt = usd;
    else if (usd < FLOOR && nudgedAt) nudgedAt = undefined; // claimed: forget the level
    return { usd, fired };
  });
  const fired = steps.filter((s) => s.fired).length;
  const naive = curve.filter((v) => v >= FLOOR).length;
  return NextResponse.json({
    floor: FLOOR,
    steps,
    fired,
    naive,
    // the assertions the gate makes
    firesOnFloorCrossing: steps[2].fired === true,
    quietWhileMerelyGrowing: steps[3].fired === false && steps[4].fired === false,
    firesOnHalfAgain: steps[5].fired === true,
    quietUnderFloor: steps[0].fired === false && steps[1].fired === false && steps[7].fired === false,
    firesAgainAfterAClaim: steps[9].fired === true,
  });
}
