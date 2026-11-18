const MIGHTPULSE_API_URL = "https://mightpulse-api.peter-neighbour4.workers.dev";
const SITE_ORIGIN = "https://tru-alliance-manager.pages.dev";

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

async function getLiveMembers() {
  const response = await fetch(MIGHTPULSE_API_URL, {
    headers: { Accept: "application/json", Origin: SITE_ORIGIN },
    signal: AbortSignal.timeout(25000),
    cache: "no-store"
  });
  if (!response.ok) throw new Error("MightPulse HTTP " + response.status);
  const data = await response.json();
  const list = Array.isArray(data.members_full) ? data.members_full : data.members;
  if (!Array.isArray(list)) throw new Error("MightPulse members array unavailable");
  const names = list.map(playerName).filter(Boolean);
  const uniqueNames = [...new Map(names.map(n => [normalise(n), n])).values()];
  if (!uniqueNames.length) throw new Error("No member names found in MightPulse response");
  return {
    names: uniqueNames,
    diagnostics: {
      allianceCount: data.alliance?.count ?? null,
      receivedMembers: list.length,
      namedMembers: names.length,
      uniqueMembers: uniqueNames.length,
      missingNames: list.length - names.length
    }
  };
}

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

function readEvent(data) {
  const name = String(data.event_name || "").trim();
  const date = String(data.event_date || "").trim();
  const description = String(data.description || "").trim();
  const valid = name && name.length <= 100 && date && Number.isFinite(Date.parse(date));
  return { name, date, description, valid };
}

export async function onRequest({ request, env }) {
  const db = env.DB;
  try {
    if (request.method === "GET") {
      const [events, signups] = await Promise.all([
        db.prepare("SELECT * FROM events ORDER BY event_date ASC").all(),
        db.prepare("SELECT signups.event_id, members.player_name FROM signups JOIN members ON members.id = signups.member_id").all()
      ]);
      let liveMembers = [], rosterAvailable = true, rosterError = null, rosterDiagnostics = null;
      try {
        const roster = await getLiveMembers();
        liveMembers = roster.names;
        rosterDiagnostics = roster.diagnostics;
      } catch (error) {
        rosterAvailable = false;
        rosterError = error.message;
      }
      return Response.json({
        events: events.results || [],
        signups: signups.results || [],
        members: liveMembers,
        rosterAvailable,
        rosterError,
        rosterDiagnostics
      });
    }

    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    const data = await request.json();

    if (["create_event", "update_event", "delete_event"].includes(data.action)) {
      if (!(await isAdmin(request, db))) {
        return Response.json({ error: "Leadership login required" }, { status: 401 });
      }

      if (data.action === "create_event") {
        const e = readEvent(data);
        if (!e.valid) return Response.json({ error: "Invalid event details" }, { status: 400 });
        await db.prepare("INSERT INTO events (event_name, event_date, description) VALUES (?, ?, ?)")
          .bind(e.name, e.date, e.description).run();
        return Response.json({ success: true });
      }

      const eventId = Number(data.event_id);
      if (!Number.isInteger(eventId) || eventId < 1) {
        return Response.json({ error: "Invalid event" }, { status: 400 });
      }

      if (data.action === "update_event") {
        const e = readEvent(data);
        if (!e.valid) return Response.json({ error: "Invalid event details" }, { status: 400 });
        await db.prepare("UPDATE events SET event_name = ?, event_date = ?, description = ? WHERE id = ?")
          .bind(e.name, e.date, e.description, eventId).run();
        return Response.json({ success: true });
      }

      await db.prepare("DELETE FROM signups WHERE event_id = ?").bind(eventId).run();
      await db.prepare("DELETE FROM events WHERE id = ?").bind(eventId).run();
      return Response.json({ success: true });
    }

    if (!["signup", "cancel"].includes(data.action)) {
      return Response.json({ error: "Invalid action" }, { status: 400 });
    }

    const eventId = Number(data.event_id);
    if (!Number.isInteger(eventId) || eventId < 1) {
      return Response.json({ error: "Invalid event" }, { status: 400 });
    }

    const event = await db.prepare("SELECT id FROM events WHERE id = ?").bind(eventId).first();
    if (!event) return Response.json({ error: "Event not found" }, { status: 404 });

    const submittedName = String(data.player_name || "").trim();
    if (!submittedName || submittedName.length > 100) {
      return Response.json({ error: "Please select your alliance name" }, { status: 400 });
    }

    let memberName = submittedName;

    if (data.action === "signup") {
      const roster = await getLiveMembers();
      const verifiedName = roster.names.find(n => normalise(n) === normalise(submittedName));
      if (!verifiedName) {
        return Response.json({ error: "That name is not on the live alliance roster." }, { status: 403 });
      }
      memberName = verifiedName;
      await db.prepare("INSERT INTO members (player_name) VALUES (?) ON CONFLICT(player_name) DO NOTHING")
        .bind(memberName).run();
    }

    const member = await db.prepare("SELECT id FROM members WHERE player_name = ?").bind(memberName).first();
    if (!member) return Response.json({ error: "Member not found" }, { status: 404 });

    if (data.action === "signup") {
      try {
        await db.prepare("INSERT INTO signups (event_id, member_id) VALUES (?, ?)").bind(eventId, member.id).run();
      } catch (error) {
        if (error.message?.includes("UNIQUE")) {
          return Response.json({ error: "Already signed up" }, { status: 409 });
        }
        throw error;
      }
      return Response.json({ success: true });
    }

    await db.prepare("DELETE FROM signups WHERE event_id = ? AND member_id = ?").bind(eventId, member.id).run();
    return Response.json({ success: true });

  } catch (error) {
    return Response.json({ error: "Request failed", details: error.message }, { status: 500 });
  }
}
