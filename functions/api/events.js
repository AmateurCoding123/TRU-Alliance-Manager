export async function onRequest({ request, env }) {
  const db = env.DB;

  try {
    if (request.method === "GET") {
      const events = await db.prepare(
        "SELECT * FROM events ORDER BY event_date ASC"
      ).all();

      const members = await db.prepare(
        "SELECT id, player_name FROM members ORDER BY player_name ASC"
      ).all();

      const signups = await db.prepare(
        `SELECT signups.event_id, members.player_name
         FROM signups
         JOIN members ON members.id = signups.member_id`
      ).all();

      return Response.json({
        events: events.results,
        members: members.results,
        signups: signups.results
      });
    }

    if (request.method === "POST") {
      const data = await request.json();

      if (data.action === "signup") {
        await db.prepare(
          `INSERT INTO signups (event_id, member_id)
           VALUES (?, ?)`
        ).bind(data.event_id, data.member_id).run();

        return Response.json({ success: true });
      }

      if (data.action === "cancel") {
        await db.prepare(
          `DELETE FROM signups
           WHERE event_id = ? AND member_id = ?`
        ).bind(data.event_id, data.member_id).run();

        return Response.json({ success: true });
      }

      return Response.json(
        { error: "Invalid action" },
        { status: 400 }
      );
    }

    return Response.json(
      { error: "Method not allowed" },
      { status: 405 }
    );

  } catch (error) {
    return Response.json(
      { error: error.message },
      { status: 400 }
    );
  }
}
