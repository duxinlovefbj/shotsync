/// <reference types="@cloudflare/workers-types" />

export interface Env {
  BUCKET: R2Bucket;
  AUTH_TOKEN: string;
  // "1" on the public demo deployment: reads (list/view) skip auth, writes
  // (upload/delete/share-create) still require the token. Unset in normal pools.
  DEMO_MODE?: string;
}

export const MAX_SINGLE_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB for direct single-request upload
export const MAX_TOTAL_FILE_BYTES = 3 * 1024 * 1024 * 1024; // 3 GB total max file size
export const RECOMMENDED_CHUNK_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB per multipart chunk
export const LARGE_FILE_THRESHOLD_BYTES = 500 * 1024 * 1024; // 500 MB threshold
export const LARGE_FILE_MAX_SHARE_TTL_SEC = 3 * 24 * 3600; // 3 days max share TTL for large files (>500MB)

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
