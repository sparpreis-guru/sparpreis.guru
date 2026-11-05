import type { NextRequest } from "next/server"
import { verifyTurnstileRequest } from "@/lib/security/turnstile"
import { issueStationSearchGrant } from "@/lib/security/station-search-grants"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  const failure = await verifyTurnstileRequest(request, "station-search")
  if (failure) return failure
  return issueStationSearchGrant(request)
}
