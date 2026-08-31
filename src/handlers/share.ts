import { Env, err, json } from "../responses";
import { isAuthed } from "../auth";
import { signShare, verifyShare } from "../share";
import { getFull } from "./image";

const DEFAULT_SHARE_TTL_SEC = 7 * 24 * 3600; // default 7 days

// POST /api/share/<id> (authed) -> mint a public, signed, expiring URL for one item.
export async function handleShareCreate(request: Request, env: Env, id: string): Promise<Response> {
  if (!isAuthed(request, env)) return err(401, "unauthorized");

  const urlObj = new URL(request.url);
  let ttlSec = Number(urlObj.searchParams.get("ttl"));

  // Check if JSON body provides ttl
  if (!ttlSec || isNaN(ttlSec) || ttlSec <= 0) {
    try {
      const contentType = request.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const body = (await request.json()) as { ttl?: number; ttlSec?: number };
        ttlSec = Number(body?.ttlSec || body?.ttl);
      }
    } catch {}
  }

  if (!ttlSec || isNaN(ttlSec) || ttlSec <= 0) {
    ttlSec = DEFAULT_SHARE_TTL_SEC;
  }

  // Cap TTL to 365 days max for safety
  ttlSec = Math.min(ttlSec, 365 * 24 * 3600);

  const exp = Date.now() + ttlSec * 1000;
  // Signing key is AUTH_TOKEN: rotating it immediately invalidates ALL live share links.
  const sig = await signShare(id, exp, env.AUTH_TOKEN);
  const origin = urlObj.origin;
  const url = `${origin}/s/${encodeURIComponent(id)}?exp=${exp}&sig=${sig}`;
  return json({ url, exp, ttlSec });
}

// GET /s/<id>?exp=&sig=  (public, no token) -> serve the one signed item.
export async function handleSharedItem(request: Request, env: Env, id: string): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const exp = Number(q.get("exp"));
  const sig = q.get("sig") || "";
  const isDownload = q.get("download") === "1";

  if (!exp || Date.now() > exp) return err(410, "link expired");
  if (!env.AUTH_TOKEN || !(await verifyShare(id, exp, sig, env.AUTH_TOKEN))) {
    return err(403, "invalid signature");
  }
  const obj = await getFull(env, id);
  if (!obj) return err(404, "not found");

  const headers: Record<string, string> = {
    "content-type": obj.httpMetadata?.contentType || "application/octet-stream",
    // Browser-only cache (never shared/CDN caches), so an expired or revoked
    // link can't keep being served from an edge cache past its TTL.
    "cache-control": "private, max-age=3600",
    "x-content-type-options": "nosniff",
  };

  const origName = obj.customMetadata?.origName;
  if (origName) {
    const encoded = encodeURIComponent(origName);
    const dispositionType = isDownload ? "attachment" : "inline";
    headers["content-disposition"] = `${dispositionType}; filename="${origName.replace(/["\\]/g, "_")}"; filename*=UTF-8''${encoded}`;
  } else if (obj.httpMetadata?.contentDisposition) {
    headers["content-disposition"] = isDownload
      ? obj.httpMetadata.contentDisposition.replace(/^inline/, "attachment")
      : obj.httpMetadata.contentDisposition;
  }

  return new Response(obj.body, { headers });
}
