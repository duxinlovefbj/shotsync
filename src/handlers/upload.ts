import { Env, err, json, MAX_SINGLE_UPLOAD_BYTES } from "../responses";
import { isAuthed } from "../auth";
import { EXT_BY_TYPE, fullKey, makeId, randSuffix, thumbKey } from "../ids";

export async function handleUpload(request: Request, env: Env): Promise<Response> {
  if (!isAuthed(request, env)) return err(401, "unauthorized");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return err(400, "expected multipart/form-data");
  }

  // Duck-type the File: `form.get()` returns `string | File | null`, and TS strict
  // rejects `instanceof File` on that union (TS2358), so narrow by shape instead.
  const fullEntry = form.get("full");
  if (!fullEntry || typeof fullEntry !== "object" || !("stream" in fullEntry) || !("name" in fullEntry)) {
    return err(400, "missing full");
  }
  const full = fullEntry as File;

  // Extract MIME or fallback to octet-stream
  const contentType = full.type || "application/octet-stream";
  if (full.size > MAX_SINGLE_UPLOAD_BYTES) {
    return err(
      413,
      `file exceeds direct upload limit (${MAX_SINGLE_UPLOAD_BYTES} bytes). Use multipart upload for files up to 3GB.`,
      "FILE_TOO_LARGE"
    );
  }

  const thumbEntry = form.get("thumb");
  const hasThumb = !!(thumbEntry && typeof thumbEntry === "object" && "stream" in thumbEntry && "name" in thumbEntry);

  const rawFilename = request.headers.get("x-filename") || full.name || "file";
  // Decode if header was URI encoded
  let origName = rawFilename;
  try {
    origName = decodeURIComponent(rawFilename);
  } catch {}

  const id = makeId(Date.now(), randSuffix());
  const meta = {
    source: request.headers.get("x-source") || "unknown",
    origName,
    uploadedAt: new Date().toISOString(),
    hasThumb: String(hasThumb),
  };

  const encodedFilename = encodeURIComponent(origName);
  const contentDisposition = `inline; filename="${origName.replace(/["\\]/g, "_")}"; filename*=UTF-8''${encodedFilename}`;

  await env.BUCKET.put(fullKey(id), full.stream(), {
    httpMetadata: {
      contentType,
      contentDisposition,
    },
    customMetadata: meta,
  });

  if (hasThumb) {
    const thumb = thumbEntry as Blob;
    await env.BUCKET.put(thumbKey(id), thumb.stream(), {
      httpMetadata: { contentType: "image/jpeg" },
    });
  }

  return json({ id, origName });
}
