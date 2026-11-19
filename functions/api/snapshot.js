// Daily automatic power snapshot, called by the "tru-daily-snapshot" Worker
// (see cron-worker/). It needs the SNAPSHOT_KEY secret in the X-Snapshot-Key header.
import { sameSecret } from "../_lib/shared.js";
import { ALLIANCES, saveSnapshot } from "../_lib/power.js";

export async function onRequest({ request, env }) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (!env.SNAPSHOT_KEY) {
    return Response.json({ error: "SNAPSHOT_KEY is not set up in Cloudflare" }, { status: 503 });
  }
  const given = String(request.headers.get("X-Snapshot-Key") || "");
  if (!given || given.length > 200 || !(await sameSecret(given, env.SNAPSHOT_KEY))) {
    return Response.json({ error: "Wrong snapshot key" }, { status: 401 });
  }

  // Each alliance on its own, so one failing doesn't stop the other.
  const results = {};
  let failed = false;
  for (const [key, alliance] of Object.entries(ALLIANCES)) {
    try {
      const { live, today } = await saveSnapshot(env.DB, alliance);
      results[key] = { saved: live.length, date: today };
    } catch (error) {
      failed = true;
      results[key] = { error: error.message };
    }
  }
  return Response.json({ success: !failed, results }, { status: failed ? 500 : 200 });
}
