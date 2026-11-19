// Power snapshots, shared by /api/power (leaders viewing growth) and
// /api/snapshot (the daily automatic snapshot).
import { MIGHTPULSE_URL, normalise, playerName, fetchMightPulse } from "./shared.js";

export const KEEP_DAYS = 90;
export const DAY = 86400000;

// One entry per alliance. Each gets its own snapshot table, so rosters and
// history never mix. "main" keeps the original table name, so existing data is untouched.
export const ALLIANCES = {
  main: {
    table: "power_snapshots",
    source: MIGHTPULSE_URL
  },
  academy: {
    table: "power_snapshots_academy",
    // Same Worker, asking for the academy. Its tag is set in the Worker.
    source: MIGHTPULSE_URL + "?alliance=academy"
  }
};

export function dayString(ms) {
  return new Date(ms).toISOString().slice(0, 10);
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
  const { list } = await fetchMightPulse(sourceUrl);
  const byName = new Map();
  for (const m of list) {
    const name = playerName(m);
    const power = playerPower(m);
    if (name && power !== null) byName.set(normalise(name), { name, power });
  }
  if (!byName.size) throw new Error("No member names with power found in MightPulse response");
  return [...byName.values()];
}

// Fetches live power for one alliance and saves (or refreshes) today's snapshot.
// Returns { table, live, today }. `alliance` must come from ALLIANCES.
export async function saveSnapshot(db, alliance) {
  const table = alliance.table; // from the fixed list above, never from user input
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS " + table + " (snap_date TEXT NOT NULL, player_name TEXT NOT NULL, power INTEGER NOT NULL, PRIMARY KEY (snap_date, player_name))"
  ).run();

  const live = await getLiveMembers(alliance.source);
  const today = dayString(Date.now());
  const insert = db.prepare(
    "INSERT OR REPLACE INTO " + table + " (snap_date, player_name, power) VALUES (?, ?, ?)"
  );
  for (let i = 0; i < live.length; i += 50) {
    await db.batch(live.slice(i, i + 50).map(m => insert.bind(today, m.name, Math.round(m.power))));
  }
  await db.prepare("DELETE FROM " + table + " WHERE snap_date < ?")
    .bind(dayString(Date.now() - KEEP_DAYS * DAY)).run();
  return { table, live, today };
}
