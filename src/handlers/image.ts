import { Env, err } from "../responses";
import { canRead } from "../auth";
import { FULL_EXTS, thumbKey } from "../ids";

// Try to find full item (first direct full/${id}, then fallback to candidate extensions)
export async function getFull(env: Env, id: string, range?: R2Range | Headers): Promise<R2ObjectBody | null> {
  const direct = await env.BUCKET.get(`full/${id}`, { range });
  if (direct) return direct;

  for (const ext of FULL_EXTS) {
    const obj = await env.BUCKET.get(`full/${id}.${ext}`, { range });
    if (obj) return obj;
  }
  return null;
}

export async function handleImage(request: Request, env: Env, id: string): Promise<Response> {
  // Check authentication
  if (!canRead(request, env)) return err(401, "unauthorized");

  // Get size parameter from query string
  const url = new URL(request.url);
  const size = url.searchParams.get("size");
  const isDownload = url.searchParams.get("download") === "1";
  const rangeHeader = request.headers.get("range");

  let obj: R2ObjectBody | null = null;

  // If size=thumb is requested, try to fetch thumb
  if (size === "thumb") obj = await env.BUCKET.get(thumbKey(id));

  // Fall back to full image if thumb not found or not requested (support HTTP Range)
  if (!obj) obj = await getFull(env, id, rangeHeader ? request.headers : undefined);

  // Return 404 if nothing found
  if (!obj) return err(404, "not found");

  const headers: Record<string, string> = {
    "content-type": obj.httpMetadata?.contentType || "application/octet-stream",
    "cache-control": "private, max-age=31536000, immutable",
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

  // Set Range / 206 headers only if client sent a Range header and R2 sliced the body
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
  return new Response(obj.body, { status: 200, headers });
}
