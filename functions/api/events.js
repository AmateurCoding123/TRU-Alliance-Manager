
const MIGHTPULSE_API_URL = "https://mightpulse-api.peter-neighbour4.workers.dev";

function normalise(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function playerName(member) {
  const player = member?.player || member;

  const name =
    player?.nick_name ||
    player?.nickname ||
    player?.player_name ||
    player?.name;

  return name ? String(name).trim() : null;
}

async function getLiveMembers() {
  const response = await fetch(MIGHTPULSE_API_URL, {
    headers: { Accept: "application/json" },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("MightPulse is unavailable");
  }

  const data = await response.json();

  if (!Array.isArray(data.members)) {
    throw new Error("MightPulse members array unavailable");
  }

  const names = data.members
    .filter(member => member && member.ok !== false)
    .map(playerName)
    .filter(name => name && name !== "Unknown" && name.length <= 100);

  const uniqueNames = [
    ...new Map(names.map(name => [normalise(name), name])).values()
  ];

  if (!uniqueNames.length) {
    throw new Error("Could not read the MightPulse member list");
  }

  return uniqueNames;
}

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

      let liveMembers = [];
      let rosterAvailable = true;

      try {
        liveMembers = await getLiveMembers();
      } catch (error) {
        rosterAvailable = false;
      }

      return Response.json({
        events: events.results,
        signups: signups.results,
        members: liveMembers,
        rosterAvailable
      });
    }

    if (request.method !== "POST") {
      return Response.json(
        { error: "Method not allowed" },
        { status: 405 }
      );
    }

    const data = await request.json();

    if (["create_event", "update_event", "delete_event"].includes(data.action)) {
      if (!(await isAdmin(request, db))) {
        return Response.json(
          { error: "Leadership login required" },
          { status: 401 }
        );
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

    if (!["signup", "cancel"].includes(data.action)) {
      return Response.json({ error: "Invalid action" }, { status: 400 });
    }

    const eventId = Number(data.event_id);

    if (!Number.isInteger(eventId) || eventId < 1) {
      return Response.json({ error: "Invalid event" }, { status: 400 });
    }

    const event = await db.prepare(
      "SELECT id FROM events WHERE id = ?"
    ).bind(eventId).first();

    if (!event) {
      return Response.json({ error: "Event not found" }, { status: 404 });
    }

    const submittedName = String(data.player_name || "").trim();

    if (!submittedName || submittedName.length > 100) {
      return Response.json({ error: "Please select your alliance name" }, { status: 400 });
    }

    let memberName = submittedName;

    if (data.action === "signup") {
      const liveMembers = await getLiveMembers();

      const verifiedName = liveMembers.find(
        name => normalise(name) === normalise(submittedName)
      );

      if (!verifiedName) {
        return Response.json(
          { error: "That name is not on the live alliance roster." },
          { status: 403 }
        );
      }

      memberName = verifiedName;

      await db.prepare(
        `INSERT INTO members (player_name)
         VALUES (?)
         ON CONFLICT(player_name) DO NOTHING`
      ).bind(memberName).run();
    }

    const member = await db.prepare(
      "SELECT id FROM members WHERE player_name = ?"
    ).bind(memberName).first();

    if (!member) {
      return Response.json({ error: "Member not found" }, { status: 404 });
    }

    if (data.action === "signup") {
      try {
        await db.prepare(
          "INSERT INTO signups (event_id, member_id) VALUES (?, ?)"
        ).bind(eventId, member.id).run();
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
    ).bind(eventId, member.id).run();

    return Response.json({ success: true });

  } catch (error) {
    return Response.json(
      { error: "Request failed" },
      { status: 400 }
    );
  }
}
