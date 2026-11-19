import { EVENT_OPEN_MS, isAdmin, sameSecret, normalise, playerName, fetchMightPulse } from "../_lib/shared.js";

async function getLiveMembers() {
  const { data, list } = await fetchMightPulse();
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

const PIN_WINDOW_MS = 15 * 60000; // count wrong member PINs over 15 minutes
const MAX_PIN_FAILURES = 10;       // per IP address in that window

// Checks the shared alliance PIN (the MEMBER_PIN secret). Returns null when the
// PIN is right, or an error Response. Wrong guesses are limited per IP address,
// using the same table as wrong leadership passwords (marked "pin:").
async function checkMemberPin(request, db, env, given) {
  const ip = "pin:" + (request.headers.get("CF-Connecting-IP") || "unknown");
  const now = Date.now();
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS login_failures (ip TEXT NOT NULL, at INTEGER NOT NULL)"),
    db.prepare("DELETE FROM login_failures WHERE at < ?").bind(now - PIN_WINDOW_MS)
  ]);
  const recent = await db.prepare("SELECT COUNT(*) AS n FROM login_failures WHERE ip = ?").bind(ip).first();
  if ((recent?.n || 0) >= MAX_PIN_FAILURES) {
    return Response.json({ error: "Too many wrong PINs. Please wait 15 minutes and try again." }, { status: 429 });
  }
  const pin = String(given || "").trim();
  if (!pin || pin.length > 20 || !(await sameSecret(pin, String(env.MEMBER_PIN).trim()))) {
    await db.prepare("INSERT INTO login_failures (ip, at) VALUES (?, ?)").bind(ip, now).run();
    return Response.json({ error: "Wrong alliance PIN. Ask Gassed for the PIN.", code: "bad_pin" }, { status: 403 });
  }
  return null;
}

// True once an event started more than EVENT_OPEN_MS ago. Dates saved before
// Nov 2026 have no timezone, so they get 14 hours' extra slack to be safe.
function eventIsOver(eventDate) {
  const text = String(eventDate || "");
  const start = Date.parse(text);
  if (!Number.isFinite(start)) return false;
  const hasZone = /(Z|[+-]\d\d:?\d\d)$/i.test(text);
  return Date.now() > start + EVENT_OPEN_MS + (hasZone ? 0 : 14 * 3600000);
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
        rosterDiagnostics,
        // Sign-ups need the alliance PIN once the MEMBER_PIN secret is set.
        pinRequired: !!env.MEMBER_PIN
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
        const result = await db.prepare("UPDATE events SET event_name = ?, event_date = ?, description = ? WHERE id = ?")
          .bind(e.name, e.date, e.description, eventId).run();
        if (!result.meta?.changes) return Response.json({ error: "Event not found" }, { status: 404 });
        return Response.json({ success: true });
      }

      // Remove the event with its sign-ups and attendance, all or nothing.
      await db.batch([
        db.prepare("CREATE TABLE IF NOT EXISTS attendance (event_id INTEGER NOT NULL, player_name TEXT NOT NULL, attended INTEGER NOT NULL, PRIMARY KEY (event_id, player_name))"),
        db.prepare("DELETE FROM attendance WHERE event_id = ?").bind(eventId),
        db.prepare("DELETE FROM signups WHERE event_id = ?").bind(eventId),
        db.prepare("DELETE FROM events WHERE id = ?").bind(eventId)
      ]);
      return Response.json({ success: true });
    }

    if (!["signup", "cancel"].includes(data.action)) {
      return Response.json({ error: "Invalid action" }, { status: 400 });
    }

    // Members have no logins, so only leaders may remove a sign-up.
    if (data.action === "cancel" && !(await isAdmin(request, db))) {
      return Response.json({ error: "Only leaders can cancel sign-ups. Please ask Gassed." }, { status: 401 });
    }

    const eventId = Number(data.event_id);
    if (!Number.isInteger(eventId) || eventId < 1) {
      return Response.json({ error: "Invalid event" }, { status: 400 });
    }

    const event = await db.prepare("SELECT id, event_date FROM events WHERE id = ?").bind(eventId).first();
    if (!event) return Response.json({ error: "Event not found" }, { status: 404 });

    if (data.action === "signup" && eventIsOver(event.event_date)) {
      return Response.json({ error: "This event is over, so sign-ups are closed." }, { status: 409 });
    }

    const submittedName = String(data.player_name || "").trim();
    if (!submittedName || submittedName.length > 100) {
      return Response.json({ error: "Please select your alliance name" }, { status: 400 });
    }

    let memberName = submittedName;

    // Members need the shared alliance PIN to sign up; logged-in leaders don't.
    if (data.action === "signup" && env.MEMBER_PIN && !(await isAdmin(request, db))) {
      const refused = await checkMemberPin(request, db, env, data.pin);
      if (refused) return refused;
    }

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
