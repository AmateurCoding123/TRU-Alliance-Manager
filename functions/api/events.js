
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

    if (request.method === "POST") {
      const data = await request.json();

      if (!data.event_id || !Number.isInteger(Number(data.event_id))) {
        return Response.json(
          { error: "Invalid event" },
          { status: 400 }
        );
      }

      if (data.action === "signup" || data.action === "cancel") {
        let memberId = data.member_id;

        if (data.player_name) {
          const name = String(data.player_name).trim();

          if (!name || name.length > 100) {
            return Response.json(
              { error: "Invalid player name" },
              { status: 400 }
            );
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

        if (!memberId) {
          return Response.json(
            { error: "Member not found" },
            { status: 404 }
          );
        }

        if (data.action === "signup") {
          try {
            await db.prepare(
              `INSERT INTO signups (event_id, member_id)
               VALUES (?, ?)`
            ).bind(Number(data.event_id), Number(memberId)).run();
          } catch (error) {
            if (error.message?.includes("UNIQUE")) {
              return Response.json(
                { error: "Already signed up" },
                { status: 409 }
              );
            }
            throw error;
          }

          return Response.json({ success: true });
        }

        await db.prepare(
          `DELETE FROM signups
           WHERE event_id = ? AND member_id = ?`
        ).bind(Number(data.event_id), Number(memberId)).run();

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
