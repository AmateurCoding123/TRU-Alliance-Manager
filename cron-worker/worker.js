// TRU daily power snapshot.
// A tiny Cloudflare Worker that runs on a schedule (Cron Triggers) and asks the
// site to save today's power for both alliances, so Power Growth has a data point
// every day even when no leader opens it.
//
// Needs one secret on this Worker: SNAPSHOT_KEY, with exactly the same value as
// the SNAPSHOT_KEY secret on the tru-alliance-manager Pages project.

const SNAPSHOT_URL = "https://tru-alliance-manager.pages.dev/api/snapshot";

async function takeSnapshot(env) {
  if (!env.SNAPSHOT_KEY) throw new Error("SNAPSHOT_KEY secret is missing on this Worker");
  const response = await fetch(SNAPSHOT_URL, {
    method: "POST",
    headers: { "X-Snapshot-Key": env.SNAPSHOT_KEY }
  });
  const text = await response.text();
  console.log("Snapshot", response.status, text);
  // Throwing marks the run as failed in the Worker's Cron Events log.
  if (!response.ok) throw new Error("Snapshot failed: HTTP " + response.status + " " + text);
  return text;
}

export default {
  // Runs on the schedule set in Settings > Triggers > Cron Triggers.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(takeSnapshot(env));
  },

  // Visiting the Worker's address just says what it is; it never takes a snapshot,
  // so nobody can trigger one from a browser.
  async fetch() {
    return new Response("TRU daily power snapshot worker. Runs on its own schedule.", {
      headers: { "Content-Type": "text/plain" }
    });
  }
};
