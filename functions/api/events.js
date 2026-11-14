
async function isAdmin(request, db) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  if (!token || token.length > 100) return false;

  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );

  const tokenHash = Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  const session = await db.prepare(
    "SELECT token_hash FROM admin_sessions WHERE token_hash = ? AND expires_at > ?"
  ).bind(tokenHash, Date.now()).first();

  return !!session;
}

export async function onRequest({ request, env }) {
  const db = env.DB;

  try {
    if (request.method === "GET") {
      const events = await db.prepare(
        "SELECT * FROM events ORDER BY event_date ASC"
      ).all();

      const signups = await db.prepare(
        `SELECT signups.event_id, members.player_name
         FROM signups
         JOIN members ON members.id = signups.member_id`
      ).all();

      return Response.json({
        events: events.results,
        signups: signups.results
      });
    }

    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    const data = await request.json();

    // Leadership-only event management
    if (["create_event", "update_event", "delete_event"].includes(data.action)) {
      if (!(await isAdmin(request, db))) {
        return Response.json({ error: "Leadership login required" }, { status: 401 });
      }

      if (data.action === "create_event") {
        const name = String(data.event_name || "").trim();
        const date = String(data.event_date || "").trim();
        const description = String(data.description || "").trim();

        if (!name || name.length > 100 || !date || !Number.isFinite(Date.parse(date))) {
          return Response.json({ error: "Invalid event details" }, { status: 400 });
        }

        await db.prepare(
          "INSERT INTO events (event_name, event_date, description) VALUES (?, ?, ?)"
        ).bind(name, date, description).run();

        return Response.json({ success: true });
      }

      if (!Number.isInteger(Number(data.event_id)) || Number(data.event_id) < 1) {
        return Response.json({ error: "Invalid event" }, { status: 400 });
      }

      if (data.action === "update_event") {
        const name = String(data.event_name || "").trim();
        const date = String(data.event_date || "").trim();
        const description = String(data.description || "").trim();

        if (!name || name.length > 100 || !date || !Number.isFinite(Date.parse(date))) {
          return Response.json({ error: "Invalid event details" }, { status: 400 });
        }

        await db.prepare(
          "UPDATE events SET event_name = ?, event_date = ?, description = ? WHERE id = ?"
        ).bind(name, date, description, Number(data.event_id)).run();

        return Response.json({ success: true });
      }

      await db.prepare(
        "DELETE FROM signups WHERE event_id = ?"
      ).bind(Number(data.event_id)).run();

      await db.prepare(
        "DELETE FROM events WHERE id = ?"
      ).bind(Number(data.event_id)).run();

      return Response.json({ success: true });
    }

    // Member sign-ups and cancellations
    if (!["signup", "cancel"].includes(data.action)) {
      return Response.json({ error: "Invalid action" }, { status: 400 });
    }

    if (!Number.isInteger(Number(data.event_id)) || Number(data.event_id) < 1) {
      return Response.json({ error: "Invalid event" }, { status: 400 });
    }

    const event = await db.prepare(
      "SELECT id FROM events WHERE id = ?"
    ).bind(Number(data.event_id)).first();

    if (!event) {
      return Response.json({ error: "Event not found" }, { status: 404 });
    }

    let memberId = data.member_id;

    if (data.player_name) {
      const name = String(data.player_name).trim();

      if (!name || name.length > 100) {
        return Response.json({ error: "Invalid player name" }, { status: 400 });
      }

      if (data.action === "signup") {
        await db.prepare(
          `INSERT INTO members (player_name)
           VALUES (?)
           ON CONFLICT(player_name) DO NOTHING`
        ).bind(name).run();
      }

      const member = await db.prepare(
        "SELECT id FROM members WHERE player_name = ?"
      ).bind(name).first();

      memberId = member?.id;
    }

    if (!Number.isInteger(Number(memberId)) || Number(memberId) < 1) {
      return Response.json({ error: "Member not found" }, { status: 404 });
    }

    if (data.action === "signup") {
      try {
        await db.prepare(
          "INSERT INTO signups (event_id, member_id) VALUES (?, ?)"
        ).bind(Number(data.event_id), Number(memberId)).run();
      } catch (error) {
        if (error.message?.includes("UNIQUE")) {
          return Response.json({ error: "Already signed up" }, { status: 409 });
        }
        throw error;
      }

      return Response.json({ success: true });
    }

    await db.prepare(
      "DELETE FROM signups WHERE event_id = ? AND member_id = ?"
    ).bind(Number(data.event_id), Number(memberId)).run();

    return Response.json({ success: true });

  } catch (error) {
    return Response.json({ error: "Request failed" }, { status: 400 });
  }
}
