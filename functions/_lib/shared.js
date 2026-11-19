// Shared helpers for the API in functions/api/.
// This file exports no request handlers, so Cloudflare doesn't turn it into a URL.

export const MIGHTPULSE_URL = "https://mightpulse-api.peter-neighbour4.workers.dev";
export const SITE_ORIGIN = "https://tru-alliance-manager.pages.dev";

// How long after an event starts it still counts as "current" (sign-ups stay open).
export const EVENT_OPEN_MS = 3 * 3600000;

export async function sha256Hex(text) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Compares two strings without the time taken giving anything away.
export async function sameSecret(given, expected) {
  if (!expected) return false;
  const [a, b] = await Promise.all([sha256Hex(given), sha256Hex(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bearerToken(request) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return token && token.length <= 100 ? token : "";
}

// True when the request carries a valid, unexpired leadership login.
export async function isAdmin(request, db) {
  const token = bearerToken(request);
  if (!token) return false;
  const session = await db
    .prepare("SELECT token_hash FROM admin_sessions WHERE token_hash = ? AND expires_at > ?")
    .bind(await sha256Hex(token), Date.now())
    .first();
  return !!session;
}

// Ends a leadership login (used by logout).
export async function endSession(request, db) {
  const token = bearerToken(request);
  if (token) await db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
}

export function normalise(value) {
  return String(value).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function playerName(member) {
  const player = member?.player || member || {};
  const name =
    player.nick_name || player.nickname || player.player_name || player.name ||
    member?.nick_name || member?.nickname || member?.player_name || member?.name;
  if (!name) return null;
  const result = String(name).trim();
  if (!result || result.toLowerCase() === "unknown" || result.length > 100) return null;
  return result;
}

// Fetches the alliance from MightPulse and returns { data, list } where list is
// the raw member array. sourceUrl defaults to the main alliance.
export async function fetchMightPulse(sourceUrl = MIGHTPULSE_URL) {
  const response = await fetch(sourceUrl, {
    headers: { Accept: "application/json", Origin: SITE_ORIGIN },
    signal: AbortSignal.timeout(25000),
    cache: "no-store"
  });
  if (!response.ok) throw new Error("MightPulse HTTP " + response.status);
  const data = await response.json();
  const list = Array.isArray(data.members_full) ? data.members_full : data.members;
  if (!Array.isArray(list)) throw new Error("MightPulse members array unavailable");
  return { data, list };
}
