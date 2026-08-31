/// <reference types="@cloudflare/workers-types" />

export interface Env {
  BUCKET: R2Bucket;
  AUTH_TOKEN: string;
  // "1" on the public demo deployment: reads (list/view) skip auth, writes
  // (upload/delete/share-create) still require the token. Unset in normal pools.
  DEMO_MODE?: string;
}

export const MAX_UPLOAD_BYTES = 90 * 1024 * 1024; // 90 MB

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function err(status: number, message: string, code?: string): Response {
  return json({
    error: {
      code: code || (
        status === 400 ? "BAD_REQUEST" :
        status === 401 ? "AUTH_REQUIRED" :
        status === 403 ? "FORBIDDEN" :
        status === 404 ? "ITEM_NOT_FOUND" :
        status === 405 ? "METHOD_NOT_ALLOWED" :
        status === 410 ? "LINK_EXPIRED" :
        status === 413 ? "FILE_TOO_LARGE" :
        status === 415 ? "UNSUPPORTED_TYPE" : "ERROR"
      ),
      message,
    }
  }, status);
}
