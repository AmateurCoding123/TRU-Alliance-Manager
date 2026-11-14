export async function onRequest({ request, env }) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  try {
    const data = await request.json();
    if (data.action === "login") {
      const password = String(data.password || "");
      if (!password || password.length > 256 || password !== env.ADMIN_PASSWORD) {
        return Response.json({ error: "Incorrect password" }, { status: 401 });
      }
      const token = crypto.randomUUID();
      await env.DB.prepare(
        "CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)"
      ).run();
      const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
      const tokenHash = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
      await env.DB.prepare("INSERT INTO admin_sessions (token_hash, expires_at) VALUES (?, ?)")
        .bind(tokenHash, Date.now() + 86400000).run();
      return Response.json({ success: true, token }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: "Authentication failed" }, { status: 500 });
  }
}
