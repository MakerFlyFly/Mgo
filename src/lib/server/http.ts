import { MgoError } from "../domain/errors";
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const requestHost = request.headers.get("host") || new URL(request.url).host;
  let originMatches = !origin;
  if (origin) {
    try { const parsed = new URL(origin); originMatches = ["http:", "https:"].includes(parsed.protocol) && parsed.host === requestHost; }
    catch { originMatches = false; }
  }
  // Next may reconstruct Request.url using its internal hostname. Host remains
  // the browser-requested authority; don't trust arbitrary forwarded-host values.
  if (request.headers.get("sec-fetch-site") === "cross-site" || !originMatches) throw new MgoError("ORIGIN", "请求来源不匹配。", 403);
}
export function sessionCookie(request: Request) {
  const value = request.headers.get("cookie")?.split(";").map(s => s.trim()).find(s => s.startsWith("mgo-session="))?.slice(12);
  return value && /^[0-9a-f-]{36}$/.test(value) ? value : null;
}
export function cookieHeader(id: string, request: Request) { return `mgo-session=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`; }
export const noStoreHeaders = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" };
