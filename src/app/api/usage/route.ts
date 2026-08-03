import { NextResponse } from "next/server";
import { getRpcUsage } from "@/lib/chain/live";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Lightweight RPC usage meter — counts every Alchemy method call this server
// process has made, with a rough compute-unit estimate. Handy for confirming we
// stay under budget. Not linked anywhere; hit /api/usage directly.
export async function GET() {
  return NextResponse.json(getRpcUsage());
}
