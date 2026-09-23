import {
  Env,
  err,
  json,
  LARGE_FILE_THRESHOLD_BYTES,
  LARGE_FILE_MAX_SHARE_TTL_SEC
} from "../responses";
import { isAuthed } from "../auth";
import { signShare, verifyShare } from "../share";
import { getFull } from "./image";

const DEFAULT_SHARE_TTL_SEC = 7 * 24 * 3600; // default 7 days
const SHORT_CODE_BYTES = 7; // encode the first 50 random bits as 10 human-friendly characters
const SHORT_CODE_LENGTH = 10;
const SHORT_CODE_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const SHORT_CODE_PATTERN = /^[0-9a-hjkmnp-tv-z]{10}$/;

interface ShortShare {
  id: string;
  exp: number;
  sig: string;
}

function randomShortCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SHORT_CODE_BYTES));
  let code = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5 && code.length < SHORT_CODE_LENGTH) {
      bits -= 5;
      code += SHORT_CODE_ALPHABET[(buffer >> bits) & 31];
      buffer &= (1 << bits) - 1;
    }
    if (code.length === SHORT_CODE_LENGTH) break;
  }
  return code;
}

// POST /api/share/<id> (authed) -> mint a public, signed, expiring URL for one item.
export async function handleShareCreate(request: Request, env: Env, id: string): Promise<Response> {
  if (!isAuthed(request, env)) return err(401, "unauthorized");

  // Check object size to enforce 3-day max TTL on large files (>500MB)
  const obj = await getFull(env, id);
  if (!obj) return err(404, "item not found", "ITEM_NOT_FOUND");

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

  // If file > 500MB, cap share TTL to 3 days (259200s) to protect 10GB bucket capacity
  const isLargeFile = obj.size > LARGE_FILE_THRESHOLD_BYTES;
  if (isLargeFile) {
    ttlSec = Math.min(ttlSec, LARGE_FILE_MAX_SHARE_TTL_SEC);
  } else {
    // Normal files max 365 days
    ttlSec = Math.min(ttlSec, 365 * 24 * 3600);
  }

  const exp = Date.now() + ttlSec * 1000;
  // Signing key is AUTH_TOKEN: rotating it immediately invalidates ALL live share links.
  const sig = await signShare(id, exp, env.AUTH_TOKEN);
  const origin = urlObj.origin;
  let code = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = randomShortCode();
    if (await env.SHORT_LINKS.get(candidate) === null) {
      code = candidate;
      break;
    }
  }
  if (!code) return err(503, "could not allocate a short link", "SHORT_LINK_UNAVAILABLE");

  const mapping: ShortShare = { id, exp, sig };
  await env.SHORT_LINKS.put(code, JSON.stringify(mapping), {
    expirationTtl: Math.max(60, Math.ceil(ttlSec)),
  });

  const url = `${origin}/r/${code}`;
  return json({ url, code, exp, ttlSec, isLargeFile, maxTtlCapped: isLargeFile && ttlSec <= LARGE_FILE_MAX_SHARE_TTL_SEC });
}

// GET /r/<code> (public) -> resolve a short code and serve its signed item.
export async function handleShortShare(request: Request, env: Env, code: string): Promise<Response> {
  const normalizedCode = code.toLowerCase().replace(/o/g, "0").replace(/[il]/g, "1");
  if (!SHORT_CODE_PATTERN.test(normalizedCode)) {
    return err(404, "short link not found", "SHORT_LINK_NOT_FOUND");
  }

  const mapping = await env.SHORT_LINKS.get<ShortShare>(normalizedCode, "json");
  if (!mapping) return err(404, "short link not found", "SHORT_LINK_NOT_FOUND");

  const url = new URL(request.url);
  url.pathname = `/s/${encodeURIComponent(mapping.id)}`;
  url.searchParams.set("exp", String(mapping.exp));
  url.searchParams.set("sig", mapping.sig);
  return handleSharedItem(new Request(url, request), env, mapping.id);
}

// GET /s/<id>?exp=&sig=  (public, no token) -> serve the one signed item.
export async function handleSharedItem(request: Request, env: Env, id: string): Promise<Response> {
  const q = new URL(request.url).searchParams;
  const exp = Number(q.get("exp"));
  const sig = q.get("sig") || "";
  const isDownload = q.get("download") === "1";
  const rangeHeader = request.headers.get("range");

  if (!exp || Date.now() > exp) return err(410, "link expired", "LINK_EXPIRED");
  if (!env.AUTH_TOKEN || !(await verifyShare(id, exp, sig, env.AUTH_TOKEN))) {
    return err(403, "invalid signature", "FORBIDDEN");
  }

  const obj = await getFull(env, id, rangeHeader ? request.headers : undefined);
  if (!obj) return err(404, "not found", "ITEM_NOT_FOUND");

  const headers: Record<string, string> = {
    "content-type": obj.httpMetadata?.contentType || "application/octet-stream",
    // Browser-only cache (never shared/CDN caches), so an expired or revoked
    // link can't keep being served from an edge cache past its TTL.
    "cache-control": "private, max-age=3600",
    "x-content-type-options": "nosniff",
    "accept-ranges": "bytes",
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

  // Handle Range response for partial downloads / multi-threaded downloading
  if (rangeHeader && "range" in obj && obj.range) {
    const r = obj.range as { offset?: number; length?: number };
    const offset = r.offset ?? 0;
    const length = r.length ?? obj.size;
    const end = offset + length - 1;
    headers["content-range"] = `bytes ${offset}-${end}/${obj.size}`;
    headers["content-length"] = String(length);
    return new Response(obj.body, { status: 206, headers });
  }

  headers["content-length"] = String(obj.size);
  return new Response(obj.body, { headers });
}
