import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const T = { authorization: "Bearer test-token" };

describe("multipart upload workflow", () => {
  it("init -> upload parts -> complete full lifecycle", async () => {
    // 1. Init multipart upload session
    const initRes = await SELF.fetch("https://x/api/upload/multipart/init", {
      method: "POST",
      headers: { ...T, "content-type": "application/json" },
      body: JSON.stringify({ filename: "large_archive.zip", contentType: "application/zip", size: 1000 }),
    });
    expect(initRes.status).toBe(200);
    const { id, uploadId, chunkSize } = await initRes.json<{
      id: string;
      uploadId: string;
      chunkSize: number;
    }>();
    expect(id).toBeDefined();
    expect(uploadId).toBeDefined();
    expect(chunkSize).toBe(50 * 1024 * 1024);

    // 2. Upload Part 1 (5MB chunk to meet S3 min part size constraint)
    const chunk1 = new Uint8Array(5 * 1024 * 1024);
    chunk1[0] = 1;
    chunk1[1] = 2;
    const part1Res = await SELF.fetch(
      `https://x/api/upload/multipart/part?id=${id}&uploadId=${encodeURIComponent(uploadId)}&partNumber=1`,
      {
        method: "PUT",
        headers: { ...T, "content-type": "application/octet-stream" },
        body: chunk1,
      }
    );
    expect(part1Res.status).toBe(200);
    const part1 = await part1Res.json<{ partNumber: number; etag: string }>();
    expect(part1.partNumber).toBe(1);
    expect(part1.etag).toBeDefined();

    // 3. Upload Part 2 (last part can be any size, e.g. 4 bytes)
    const chunk2 = new Uint8Array([5, 6, 7, 8]);
    const part2Res = await SELF.fetch(
      `https://x/api/upload/multipart/part?id=${id}&uploadId=${encodeURIComponent(uploadId)}&partNumber=2`,
      {
        method: "POST",
        headers: { ...T, "content-type": "application/octet-stream" },
        body: chunk2,
      }
    );
    expect(part2Res.status).toBe(200);
    const part2 = await part2Res.json<{ partNumber: number; etag: string }>();
    expect(part2.partNumber).toBe(2);

    // 4. Complete multipart merge
    const completeRes = await SELF.fetch("https://x/api/upload/multipart/complete", {
      method: "POST",
      headers: { ...T, "content-type": "application/json" },
      body: JSON.stringify({
        id,
        uploadId,
        parts: [part1, part2],
      }),
    });
    expect(completeRes.status).toBe(200);
    const completed = await completeRes.json<{ id: string; size: number; origName: string }>();
    expect(completed.id).toBe(id);
    expect(completed.size).toBe(5 * 1024 * 1024 + 4);
    expect(completed.origName).toBe("large_archive.zip");

    // 5. Verify the merged object via GET /i/<id> with Range request
    const getRes = await SELF.fetch(`https://x/i/${id}`, {
      headers: { ...T, range: "bytes=0-1" },
    });
    expect(getRes.status).toBe(206);
    expect(getRes.headers.get("content-range")).toBe(`bytes 0-1/${5 * 1024 * 1024 + 4}`);
    expect(new Uint8Array(await getRes.arrayBuffer())).toEqual(new Uint8Array([1, 2]));

    // 6. Delete the file
    const delRes = await SELF.fetch(`https://x/api/img/${id}`, { method: "DELETE", headers: T });
    expect(delRes.status).toBe(200);
    await delRes.json();
  });

  it("aborts multipart session properly", async () => {
    const initRes = await SELF.fetch("https://x/api/upload/multipart/init", {
      method: "POST",
      headers: { ...T, "content-type": "application/json" },
      body: JSON.stringify({ filename: "abandoned.iso", size: 5000 }),
    });
    const { id, uploadId } = await initRes.json<{ id: string; uploadId: string }>();

    const abortRes = await SELF.fetch("https://x/api/upload/multipart/abort", {
      method: "POST",
      headers: { ...T, "content-type": "application/json" },
      body: JSON.stringify({ id, uploadId }),
    });
    expect(abortRes.status).toBe(200);
    expect((await abortRes.json<{ aborted: boolean }>()).aborted).toBe(true);
  });
});
