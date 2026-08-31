import {
  Env,
  err,
  json,
  MAX_TOTAL_FILE_BYTES,
  RECOMMENDED_CHUNK_SIZE_BYTES
} from "../responses";
import { isAuthed } from "../auth";
import { fullKey, makeId, randSuffix } from "../ids";

// 1. POST /api/upload/multipart/init -> 创建 S3 分块上传会话
export async function handleMultipartInit(request: Request, env: Env): Promise<Response> {
  if (!isAuthed(request, env)) return err(401, "unauthorized", "AUTH_REQUIRED");

  let body: { filename?: string; contentType?: string; size?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return err(400, "expected JSON body with filename and size", "BAD_REQUEST");
  }

  const rawFilename = body.filename || request.headers.get("x-filename") || "file";
  let origName = rawFilename;
  try {
    origName = decodeURIComponent(rawFilename);
  } catch {}

  const totalSize = Number(body.size);
  if (totalSize && totalSize > MAX_TOTAL_FILE_BYTES) {
    return err(
      413,
      `file size (${totalSize} bytes) exceeds max 3GB limit (${MAX_TOTAL_FILE_BYTES} bytes)`,
      "FILE_TOO_LARGE"
    );
  }

  const id = makeId(Date.now(), randSuffix());
  const contentType = body.contentType || "application/octet-stream";
  const encodedFilename = encodeURIComponent(origName);
  const contentDisposition = `inline; filename="${origName.replace(/["\\]/g, "_")}"; filename*=UTF-8''${encodedFilename}`;

  const meta = {
    source: request.headers.get("x-source") || "multipart",
    origName,
    uploadedAt: new Date().toISOString(),
    hasThumb: "false",
    isMultipart: "true",
  };

  const multipart = await env.BUCKET.createMultipartUpload(fullKey(id), {
    httpMetadata: {
      contentType,
      contentDisposition,
    },
    customMetadata: meta,
  });

  return json({
    id,
    origName,
    uploadId: multipart.uploadId,
    chunkSize: RECOMMENDED_CHUNK_SIZE_BYTES, // 50MB
    maxTotalBytes: MAX_TOTAL_FILE_BYTES, // 3GB
  });
}

// 2. PUT /api/upload/multipart/part?id=<id>&uploadId=<uploadId>&partNumber=<N> -> 上传单分块
export async function handleMultipartPart(request: Request, env: Env): Promise<Response> {
  if (!isAuthed(request, env)) return err(401, "unauthorized", "AUTH_REQUIRED");

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const uploadId = url.searchParams.get("uploadId");
  const partNumber = Number(url.searchParams.get("partNumber"));

  if (!id || !uploadId || !partNumber || partNumber < 1 || partNumber > 10000) {
    return err(400, "missing or invalid id, uploadId, or partNumber (1-10000)", "BAD_REQUEST");
  }

  if (!request.body) {
    return err(400, "missing chunk binary body", "BAD_REQUEST");
  }

  const chunkBuffer = await request.arrayBuffer();
  if (chunkBuffer.byteLength === 0) {
    return err(400, "chunk body is empty", "BAD_REQUEST");
  }

  const multipart = env.BUCKET.resumeMultipartUpload(fullKey(id), uploadId);
  try {
    const uploadedPart = await multipart.uploadPart(partNumber, chunkBuffer);
    return json({
      partNumber: uploadedPart.partNumber,
      etag: uploadedPart.etag,
    });
  } catch (e: any) {
    return err(500, `upload part failed: ${e?.message || String(e)}`, "STORAGE_ERROR");
  }
}

// 3. POST /api/upload/multipart/complete -> 完成分块合并
export async function handleMultipartComplete(request: Request, env: Env): Promise<Response> {
  if (!isAuthed(request, env)) return err(401, "unauthorized", "AUTH_REQUIRED");

  let body: { id?: string; uploadId?: string; parts?: { partNumber: number; etag: string }[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return err(400, "expected JSON body with id, uploadId, and parts array", "BAD_REQUEST");
  }

  const { id, uploadId, parts } = body;
  if (!id || !uploadId || !Array.isArray(parts) || parts.length === 0) {
    return err(400, "missing id, uploadId, or parts array", "BAD_REQUEST");
  }

  // Ensure parts are sorted by partNumber ascending and map fields correctly
  const sortedParts = [...parts]
    .sort((a, b) => a.partNumber - b.partNumber)
    .map((p) => ({ partNumber: Number(p.partNumber), etag: String(p.etag) }));

  const multipart = env.BUCKET.resumeMultipartUpload(fullKey(id), uploadId);
  try {
    const r2Obj = await multipart.complete(sortedParts);
    if (r2Obj.size > MAX_TOTAL_FILE_BYTES) {
      await env.BUCKET.delete(fullKey(id));
      return err(413, "merged file exceeded 3GB limit", "FILE_TOO_LARGE");
    }

    return json({
      id,
      size: r2Obj.size,
      etag: r2Obj.etag,
      origName: r2Obj.customMetadata?.origName || id,
    });
  } catch (e: any) {
    return err(500, `complete multipart upload failed: ${e?.message || String(e)}`, "STORAGE_ERROR");
  }
}

// 4. POST /api/upload/multipart/abort -> 中止取消并清理临时分块
export async function handleMultipartAbort(request: Request, env: Env): Promise<Response> {
  if (!isAuthed(request, env)) return err(401, "unauthorized", "AUTH_REQUIRED");

  let body: { id?: string; uploadId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return err(400, "expected JSON body with id and uploadId", "BAD_REQUEST");
  }

  const { id, uploadId } = body;
  if (!id || !uploadId) {
    return err(400, "missing id or uploadId", "BAD_REQUEST");
  }

  const multipart = env.BUCKET.resumeMultipartUpload(fullKey(id), uploadId);
  try {
    await multipart.abort();
    return json({ aborted: true });
  } catch (e: any) {
    return err(500, `abort multipart upload failed: ${e?.message || String(e)}`, "STORAGE_ERROR");
  }
}
