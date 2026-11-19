import { isAdmin, normalise } from "../_lib/shared.js";
import { ALLIANCES, DAY, dayString, saveSnapshot } from "../_lib/power.js";

export async function onRequest({ request, env }) {
  if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const db = env.DB;
  try {
    if (!(await isAdmin(request, db))) {
      return Response.json({ error: "Leadership login required" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }
    const params = new URL(request.url).searchParams;
    const key = params.get("alliance") || "main";
    const alliance = Object.prototype.hasOwnProperty.call(ALLIANCES, key) ? ALLIANCES[key] : null;
    if (!alliance) {
      return Response.json({ error: "Unknown alliance" }, { status: 400 });
    }
    if (!alliance.source) {
      return Response.json(
        { error: "Not set up", details: "No MightPulse source URL is configured for '" + key + "' yet." },
        { status: 501 }
      );
    }
    const asked = Number(params.get("days"));
    const days = [1, 7, 30].includes(asked) ? asked : 1;

    // Save (or refresh) today's snapshot, then compare with an earlier day.
    const { table, live, today } = await saveSnapshot(db, alliance);

    // Choose the earlier day to compare against.
    const datesResult = await db.prepare("SELECT DISTINCT snap_date FROM " + table + " ORDER BY snap_date ASC").all();
    const dates = (datesResult.results || []).map(r => r.snap_date);
    const earlier = dates.filter(d => d < today);
    const target = dayString(Date.now() - days * DAY);
    const atOrBefore = earlier.filter(d => d <= target);
    const baselineDate = atOrBefore.length
      ? atOrBefore[atOrBefore.length - 1]
      : (earlier.length ? earlier[0] : null);

    let baseline = new Map();
    if (baselineDate) {
      const rows = await db.prepare("SELECT player_name, power FROM " + table + " WHERE snap_date = ?")
        .bind(baselineDate).all();
      for (const r of rows.results || []) baseline.set(normalise(r.player_name), r.power);
    }

    const compared = [];
    const added = [];
    for (const m of live) {
      const before = baseline.get(normalise(m.name));
      if (!baselineDate) {
        added.push({ name: m.name, power: m.power, status: "none" });
      } else if (before === undefined) {
        added.push({ name: m.name, power: m.power, status: "new" });
      } else {
        const change = m.power - before;
        compared.push({
          name: m.name,
          power: m.power,
          change,
          pct: before > 0 ? (change / before) * 100 : 0,
          status: change === 0 ? "flat" : (change > 0 ? "up" : "down")
        });
      }
    }
    compared.sort((a, b) => b.change - a.change || b.power - a.power);
    added.sort((a, b) => b.power - a.power);

    return Response.json({
      today,
      requestedDays: days,
      baselineDate,
      snapshotDays: dates.length,
      members: [...compared, ...added]
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: "Request failed", details: error.message }, { status: 500 });
  }
}
