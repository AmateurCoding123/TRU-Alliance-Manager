async function isAdmin(request, db) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token.length > 100) return false;
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const tokenHash = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
  const session = await db
    .prepare("SELECT token_hash FROM admin_sessions WHERE token_hash = ? AND expires_at > ?")
    .bind(tokenHash, Date.now())
    .first();
  return !!session;
}

function cleanNames(list) {
  const names = Array.isArray(list) ? list : [];
  return [...new Set(names.map(n => String(n).trim()).filter(n => n && n.length <= 100))].slice(0, 500);
}

export async function onRequest({ request, env }) {
  const db = env.DB;
  try {
    if (!(await isAdmin(request, db))) {
      return Response.json({ error: "Leadership login required" }, { status: 401 });
    }

    await db.prepare(
      "CREATE TABLE IF NOT EXISTS attendance (event_id INTEGER NOT NULL, player_name TEXT NOT NULL, attended INTEGER NOT NULL, PRIMARY KEY (event_id, player_name))"
    ).run();

    if (request.method === "GET") {
      const rows = await db.prepare("SELECT event_id, player_name, attended FROM attendance").all();
      return Response.json({ records: rows.results || [] });
    }

    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    const data = await request.json();
    if (data.action !== "save") {
      return Response.json({ error: "Invalid action" }, { status: 400 });
    }

    const eventId = Number(data.event_id);
    if (!Number.isInteger(eventId) || eventId < 1) {
      return Response.json({ error: "Invalid event" }, { status: 400 });
    }
    const event = await db.prepare("SELECT id FROM events WHERE id = ?").bind(eventId).first();
    if (!event) return Response.json({ error: "Event not found" }, { status: 404 });

    const present = cleanNames(data.present);
    const presentSet = new Set(present);
    const absent = cleanNames(data.absent).filter(n => !presentSet.has(n));

    const statements = [db.prepare("DELETE FROM attendance WHERE event_id = ?").bind(eventId)];
    for (const name of present) {
      statements.push(db.prepare("INSERT INTO attendance (event_id, player_name, attended) VALUES (?, ?, 1)").bind(eventId, name));
    }
    for (const name of absent) {
      statements.push(db.prepare("INSERT INTO attendance (event_id, player_name, attended) VALUES (?, ?, 0)").bind(eventId, name));
    }
    await db.batch(statements);

    return Response.json({ success: true });
  } catch (error) {
    return Response.json({ error: "Request failed", details: error.message }, { status: 500 });
  }
}
