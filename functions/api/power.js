const SITE_ORIGIN = "https://tru-alliance-manager.pages.dev";
const KEEP_DAYS = 90;
const DAY = 86400000;

// One entry per alliance. Each gets its own snapshot table, so rosters and
// history never mix. "main" keeps the original table name, so existing data is untouched.
const ALLIANCES = {
  main: {
    table: "power_snapshots",
    source: "https://mightpulse-api.peter-neighbour4.workers.dev"
  },
  academy: {
    table: "power_snapshots_academy",
    // Same Worker, asking for the academy. Its tag is set in the Worker.
    source: "https://mightpulse-api.peter-neighbour4.workers.dev?alliance=academy"
  }
};

function normalise(value) {
  return String(value).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function playerName(member) {
  const player = member?.player || member || {};
  const name =
    player.nick_name || player.nickname || player.player_name || player.name ||
    member?.nick_name || member?.nickname || member?.player_name || member?.name;
  if (!name) return null;
  const result = String(name).trim();
  if (!result || result.toLowerCase() === "unknown" || result.length > 100) return null;
  return result;
}

function playerPower(member) {
  const player = member?.player || member || {};
  let v = player.power ?? player.might ?? player.total_power ?? member?.power ?? member?.might;
  if (v && typeof v === "object") v = v.value ?? v.total ?? v.amount;
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

async function getLiveMembers(sourceUrl) {
  const response = await fetch(sourceUrl, {
    headers: { Accept: "application/json", Origin: SITE_ORIGIN },
    signal: AbortSignal.timeout(12000),
    cache: "no-store"
  });
  if (!response.ok) throw new Error("MightPulse HTTP " + response.status);
  const data = await response.json();
  const list = Array.isArray(data.members_full) ? data.members_full : data.members;
  if (!Array.isArray(list)) throw new Error("MightPulse members array unavailable");
  const byName = new Map();
  for (const m of list) {
    const name = playerName(m);
    const power = playerPower(m);
    if (name && power !== null) byName.set(normalise(name), { name, power });
  }
  if (!byName.size) throw new Error("No member names with power found in MightPulse response");
  return [...byName.values()];
}

function dayString(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export async function onRequest({ request, env }) {
  if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const db = env.DB;
  try {
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
    const table = alliance.table; // from the fixed list above, never from user input

    // Creates the snapshot table the first time; does nothing after that.
    await db.prepare(
      "CREATE TABLE IF NOT EXISTS " + table + " (snap_date TEXT NOT NULL, player_name TEXT NOT NULL, power INTEGER NOT NULL, PRIMARY KEY (snap_date, player_name))"
    ).run();

    const asked = Number(params.get("days"));
    const days = [1, 7, 30].includes(asked) ? asked : 1;

    const live = await getLiveMembers(alliance.source);
    const today = dayString(Date.now());

    // Save (or refresh) today's snapshot.
    const insert = db.prepare(
      "INSERT OR REPLACE INTO " + table + " (snap_date, player_name, power) VALUES (?, ?, ?)"
    );
    for (let i = 0; i < live.length; i += 50) {
      await db.batch(live.slice(i, i + 50).map(m => insert.bind(today, m.name, Math.round(m.power))));
    }
    await db.prepare("DELETE FROM " + table + " WHERE snap_date < ?")
      .bind(dayString(Date.now() - KEEP_DAYS * DAY)).run();

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
