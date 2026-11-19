const SESSION_MS = 86400000;          // logins last 24 hours
const ATTEMPT_WINDOW_MS = 15 * 60000; // count failed logins over 15 minutes
const MAX_FAILURES = 5;               // per IP address in that window

async function sha256Hex(text) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Compares hashes of both values so the time taken does not reveal the password.
async function samePassword(given, expected) {
  if (!expected) return false;
  const [a, b] = await Promise.all([sha256Hex(given), sha256Hex(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const db = env.DB;
  try {
    const data = await request.json();
    await db.batch([
      db.prepare("CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)"),
      db.prepare("CREATE TABLE IF NOT EXISTS login_failures (ip TEXT NOT NULL, at INTEGER NOT NULL)")
    ]);

    if (data.action === "login") {
      const now = Date.now();
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";

      // Tidy up old failures and expired logins.
      await db.batch([
        db.prepare("DELETE FROM login_failures WHERE at < ?").bind(now - ATTEMPT_WINDOW_MS),
        db.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").bind(now)
      ]);

      const recent = await db.prepare("SELECT COUNT(*) AS n FROM login_failures WHERE ip = ?").bind(ip).first();
      if ((recent?.n || 0) >= MAX_FAILURES) {
        return Response.json(
          { error: "Too many wrong attempts. Please wait 15 minutes and try again." },
          { status: 429 }
        );
      }

      const password = String(data.password || "");
      if (!password || password.length > 256 || !(await samePassword(password, env.ADMIN_PASSWORD))) {
        await db.prepare("INSERT INTO login_failures (ip, at) VALUES (?, ?)").bind(ip, now).run();
        return Response.json({ error: "Incorrect password" }, { status: 401 });
      }

      await db.prepare("DELETE FROM login_failures WHERE ip = ?").bind(ip).run();
      const token = crypto.randomUUID();
      await db.prepare("INSERT INTO admin_sessions (token_hash, expires_at) VALUES (?, ?)")
        .bind(await sha256Hex(token), now + SESSION_MS).run();
      return Response.json({ success: true, token }, { headers: { "Cache-Control": "no-store" } });
    }

    if (data.action === "logout") {
      const auth = request.headers.get("Authorization") || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (token && token.length <= 100) {
        await db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
      }
      return Response.json({ success: true });
    }

    return Response.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    return Response.json({ error: "Authentication failed" }, { status: 500 });
  }
}
