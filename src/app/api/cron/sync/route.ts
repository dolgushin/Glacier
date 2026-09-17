import { NextResponse } from "next/server";
import { cronSecretMatches, runSyncRound } from "@/lib/brokers/scheduler";

export const dynamic = "force-dynamic";

/**
 * Trigger for an external scheduler — system cron, a systemd timer, GitHub
 * Actions on a schedule:
 *
 *   curl -fsS -X POST -H "Authorization: Bearer $GLACIER_CRON_SECRET" \
 *        https://<host>/api/cron/sync
 *
 * Without GLACIER_CRON_SECRET the endpoint does not exist (404, not 401): an
 * unauthenticated URL that syncs every user's broker on demand is a free
 * rate-limit amplifier for anyone who finds it.
 */
export async function POST(request: Request) {
  const configured = process.env.GLACIER_CRON_SECRET?.trim() ?? "";
  if (!configured) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const presented = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!cronSecretMatches(presented, configured)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const round = await runSyncRound();
  return NextResponse.json(round, { status: round.errors.length > 0 ? 207 : 200 });
}
