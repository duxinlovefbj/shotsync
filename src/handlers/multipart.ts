import {
  Env,
  err,
  json,
  MAX_TOTAL_FILE_BYTES,
  RECOMMENDED_CHUNK_SIZE_BYTES,
} from "../responses";
import { isAuthed } from "../auth";
import { createMultipartTicket, MultipartTicket, verifyMultipartTicket } from "../multipartToken";
import { fullKey, makeId, randSuffix } from "../ids";

const MULTIPART_TOKEN_HEADER = "x-multipart-token";
const ID_PATTERN = /^\d{16}-[0-9a-z]{6}$/;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validId(id: unknown): id is string {
  return typeof id === "string" && ID_PATTERN.test(id);
}

function r2ErrorCode(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/\((\d+)\)\s*$/);
  return match ? Number(match[1]) : null;
}

function storageError(action: string, error: unknown): Response {
  const code = r2ErrorCode(error);
  const status =
    code === 10011 || code === 10025 || code === 10048 ? 400 :
    code === 10024 ? 404 :
    code === 10033 ? 411 :
    code === 100100 ? 413 :
    code === 10043 ? 503 :
    code === 10058 ? 429 :
    code === 10054 ? 400 : 500;
  const publicCode =
    code === 10024 ? "UPLOAD_NOT_FOUND" :
    code === 10011 || code === 10025 || code === 10048 ? "INVALID_MULTIPART" :
    code === 10033 ? "LENGTH_REQUIRED" :
    code === 100100 ? "FILE_TOO_LARGE" :
    code === 10058 ? "RATE_LIMITED" :
    code === 10043 ? "STORAGE_UNAVAILABLE" :
    code === 10054 ? "CLIENT_DISCONNECTED" : "STORAGE_ERROR";
  return err(status, `${action}: ${error instanceof Error ? error.message : String(error)}`, publicCode);
}

function sessionError(): Response {
  return err(401, "missing or invalid multipart session token", "MULTIPART_SESSION_INVALID");
}

async function ticketFor(
  request: Request,
  env: Env,
  id: string,
  uploadId: string
): Promise<MultipartTicket | Response> {
  const token = request.headers.get(MULTIPART_TOKEN_HEADER);
  if (!token) return sessionError();

  const ticket = await verifyMultipartTicket(token, env.AUTH_TOKEN, id, uploadId);
  if (!ticket || ticket.size > MAX_TOTAL_FILE_BYTES || ticket.chunkSize !== RECOMMENDED_CHUNK_SIZE_BYTES) {
    return sessionError();
  }
  return ticket;
}

function expectedPartCount(ticket: MultipartTicket): number {
  return Math.ceil(ticket.size / ticket.chunkSize);
}

function expectedPartSize(ticket: MultipartTicket, partNumber: number): number {
  const count = expectedPartCount(ticket);
  return partNumber === count
    ? ticket.size - ticket.chunkSize * (count - 1)
    : ticket.chunkSize;
}

// 1. POST /api/upload/multipart/init -> 创建 S3 分块上传会话
export async function handleMultipartInit(request: Request, env: Env): Promise<Response> {
  if (!isAuthed(request, env)) return err(401, "unauthorized", "AUTH_REQUIRED");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err(400, "expected JSON body with filename, contentType, and size", "BAD_REQUEST");
  }
  if (!isRecord(body)) return err(400, "expected a JSON object", "BAD_REQUEST");

  const size = body.size;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0) {
    return err(400, `size must be an integer between 1 and ${MAX_TOTAL_FILE_BYTES}`, "BAD_REQUEST");
  }
  if (size > MAX_TOTAL_FILE_BYTES) {
    return err(413, `file size exceeds max ${MAX_TOTAL_FILE_BYTES} bytes`, "FILE_TOO_LARGE");
  }

  const bodyFilename = typeof body.filename === "string" && body.filename.length > 0 ? body.filename : null;
  const headerFilename = request.headers.get("x-filename");
  const rawFilename = bodyFilename || headerFilename || "file";
  let origName = rawFilename;
  if (!bodyFilename && headerFilename) {
    try {
      origName = decodeURIComponent(headerFilename);
    } catch {}
  }
  origName = origName.replace(/[\r\n]/g, "");
  if (!origName || new TextEncoder().encode(origName).byteLength > 1024) {
    return err(400, "filename is empty or too long", "BAD_REQUEST");
  }

  const contentType = body.contentType === undefined ? "application/octet-stream" : body.contentType;
  if (typeof contentType !== "string" || contentType.length === 0 || contentType.length > 256) {
    return err(400, "contentType must be a non-empty string of at most 256 characters", "BAD_REQUEST");
  }

  const id = makeId(Date.now(), randSuffix());
  const encodedFilename = encodeURIComponent(origName);
  const safeFilename = origName.replace(/["\\]/g, "_");
  const contentDisposition = `inline; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`;
  const meta = {
    source: request.headers.get("x-source") || "multipart",
    origName,
    uploadedAt: new Date().toISOString(),
    hasThumb: "false",
    isMultipart: "true",
  };

  let multipart: R2MultipartUpload | undefined;
  try {
    multipart = await env.BUCKET.createMultipartUpload(fullKey(id), {
      httpMetadata: { contentType, contentDisposition },
      customMetadata: meta,
    });
    const uploadToken = await createMultipartTicket({
      id,
      uploadId: multipart.uploadId,
      size,
      chunkSize: RECOMMENDED_CHUNK_SIZE_BYTES,
    }, env.AUTH_TOKEN);

    return json({
      id,
      origName,
      uploadId: multipart.uploadId,
      uploadToken,
      chunkSize: RECOMMENDED_CHUNK_SIZE_BYTES,
      maxTotalBytes: MAX_TOTAL_FILE_BYTES,
    });
  } catch (error) {
    if (multipart) {
      try { await multipart.abort(); } catch {}
    }
    return storageError("create multipart upload failed", error);
  }
}

// 2. PUT /api/upload/multipart/part?id=<id>&uploadId=<uploadId>&partNumber=<N> -> 上传单分块
export async function handleMultipartPart(request: Request, env: Env): Promise<Response> {
  if (!isAuthed(request, env)) return err(401, "unauthorized", "AUTH_REQUIRED");

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const uploadId = url.searchParams.get("uploadId");
  const rawPartNumber = url.searchParams.get("partNumber");
  const partNumber = rawPartNumber === null ? NaN : Number(rawPartNumber);

  if (!validId(id) || !uploadId || !Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
    return err(400, "missing or invalid id, uploadId, or partNumber (1-10000)", "BAD_REQUEST");
  }

  const ticket = await ticketFor(request, env, id, uploadId);
  if (ticket instanceof Response) return ticket;

  const totalParts = expectedPartCount(ticket);
  if (partNumber > totalParts) {
    return err(400, `partNumber must be between 1 and ${totalParts}`, "BAD_REQUEST");
  }
  if (!request.body) return err(400, "missing chunk binary body", "BAD_REQUEST");

  const expectedSize = expectedPartSize(ticket, partNumber);
  const contentLength = request.headers.get("content-length");
  const actualSize = contentLength === null ? NaN : Number(contentLength);
  if (Number.isSafeInteger(actualSize) && actualSize !== expectedSize) {
    return actualSize > expectedSize
      ? err(413, `part ${partNumber} must be exactly ${expectedSize} bytes`, "PART_TOO_LARGE")
      : err(400, `part ${partNumber} must be exactly ${expectedSize} bytes`, "INVALID_PART_SIZE");
  }

  const multipart = env.BUCKET.resumeMultipartUpload(fullKey(id), uploadId);
  try {
    const uploadResult = await multipart.uploadPart(partNumber, request.body);
    return json({ partNumber: uploadResult.partNumber, etag: uploadResult.etag });
  } catch (error) {
    return storageError("upload part failed", error);
  }
}

// 3. POST /api/upload/multipart/complete -> 完成分块合并
export async function handleMultipartComplete(request: Request, env: Env): Promise<Response> {
  if (!isAuthed(request, env)) return err(401, "unauthorized", "AUTH_REQUIRED");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err(400, "expected JSON body with id, uploadId, and parts array", "BAD_REQUEST");
  }
  if (!isRecord(body)) return err(400, "expected a JSON object", "BAD_REQUEST");

  const id = body.id;
  const uploadId = body.uploadId;
  const parts = body.parts;
  if (!validId(id) || typeof uploadId !== "string" || !uploadId || !Array.isArray(parts)) {
    return err(400, "missing or invalid id, uploadId, or parts array", "BAD_REQUEST");
  }

  const ticket = await ticketFor(request, env, id, uploadId);
  if (ticket instanceof Response) return ticket;

  const totalParts = expectedPartCount(ticket);
  if (parts.length !== totalParts || parts.length > 10000) {
    return err(400, `parts must contain exactly ${totalParts} uploaded parts`, "INVALID_MULTIPART");
  }

  const normalizedParts: { partNumber: number; etag: string }[] = [];
  const seen = new Set<number>();
  for (const value of parts) {
    const partNumber = isRecord(value) ? value.partNumber : undefined;
    const etag = isRecord(value) ? value.etag : undefined;
    if (typeof partNumber !== "number" || !Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > totalParts) {
      return err(400, "each part must have a valid partNumber", "INVALID_MULTIPART");
    }
    if (typeof etag !== "string" || etag.trim() === "" || etag.length > 512) {
      return err(400, "each part must have a non-empty etag", "INVALID_MULTIPART");
    }
    if (seen.has(partNumber)) {
      return err(400, "parts must not contain duplicate partNumber values", "INVALID_MULTIPART");
    }
    seen.add(partNumber);
    normalizedParts.push({ partNumber, etag });
  }

  normalizedParts.sort((a, b) => a.partNumber - b.partNumber);
  if (normalizedParts.some((part, index) => part.partNumber !== index + 1)) {
    return err(400, "parts must contain every partNumber from 1 in ascending order", "INVALID_MULTIPART");
  }

  const multipart = env.BUCKET.resumeMultipartUpload(fullKey(id), uploadId);
  try {
    const r2Obj = await multipart.complete(normalizedParts);
    if (r2Obj.size > MAX_TOTAL_FILE_BYTES) {
      try {
        await env.BUCKET.delete(fullKey(id));
      } catch (cleanupError) {
        return storageError("delete oversized multipart object failed", cleanupError);
      }
      return err(413, "merged file exceeded 3GB limit", "FILE_TOO_LARGE");
    }

    return json({
      id,
      size: r2Obj.size,
      etag: r2Obj.etag,
      origName: r2Obj.customMetadata?.origName || id,
    });
  } catch (error) {
    return storageError("complete multipart upload failed", error);
  }
}

// 4. POST /api/upload/multipart/abort -> 中止取消并清理临时分块
export async function handleMultipartAbort(request: Request, env: Env): Promise<Response> {
  if (!isAuthed(request, env)) return err(401, "unauthorized", "AUTH_REQUIRED");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err(400, "expected JSON body with id and uploadId", "BAD_REQUEST");
  }
  if (!isRecord(body)) return err(400, "expected a JSON object", "BAD_REQUEST");

  const id = body.id;
  const uploadId = body.uploadId;
  if (!validId(id) || typeof uploadId !== "string" || !uploadId) {
    return err(400, "missing or invalid id or uploadId", "BAD_REQUEST");
  }

  const ticket = await ticketFor(request, env, id, uploadId);
  if (ticket instanceof Response) return ticket;

  const multipart = env.BUCKET.resumeMultipartUpload(fullKey(id), uploadId);
  try {
    await multipart.abort();
    return json({ aborted: true });
  } catch (error) {
    if (r2ErrorCode(error) === 10024) return json({ aborted: true });
    return storageError("abort multipart upload failed", error);
  }
}
