import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const T = { authorization: "Bearer test-token" };

describe("multipart upload workflow", () => {
  it("init -> upload parts -> complete full lifecycle", async () => {
    // 1. Init multipart upload session
    const totalSize = 50 * 1024 * 1024 + 4;
    const initRes = await SELF.fetch("https://x/api/upload/multipart/init", {
      method: "POST",
      headers: { ...T, "content-type": "application/json" },
      body: JSON.stringify({ filename: "large_archive.zip", contentType: "application/zip", size: totalSize }),
    });
    expect(initRes.status).toBe(200);
    const { id, uploadId, uploadToken, chunkSize } = await initRes.json<{
      id: string;
      uploadId: string;
      uploadToken: string;
      chunkSize: number;
    }>();
    expect(id).toBeDefined();
    expect(uploadId).toBeDefined();
    expect(chunkSize).toBe(50 * 1024 * 1024);

    // 2. Upload Part 1 (all non-final parts use the advertised 50MB size)
    const chunk1 = new Uint8Array(50 * 1024 * 1024);
    chunk1[0] = 1;
    chunk1[1] = 2;
    const part1Res = await SELF.fetch(
      `https://x/api/upload/multipart/part?id=${id}&uploadId=${encodeURIComponent(uploadId)}&partNumber=1`,
      {
        method: "PUT",
        headers: {
          ...T,
          "x-multipart-token": uploadToken,
          "content-type": "application/octet-stream",
          "content-length": String(chunk1.byteLength),
        },
        body: chunk1,
      }
    );
    expect(part1Res.status).toBe(200);
    const part1 = await part1Res.json<{ partNumber: number; etag: string }>();
    expect(part1.partNumber).toBe(1);
    expect(part1.etag).toBeDefined();

    // 3. Upload Part 2 (last part can be smaller than 5MB)
    const chunk2 = new Uint8Array([5, 6, 7, 8]);
    const part2Res = await SELF.fetch(
      `https://x/api/upload/multipart/part?id=${id}&uploadId=${encodeURIComponent(uploadId)}&partNumber=2`,
      {
      method: "PUT",
      headers: {
          ...T,
          "x-multipart-token": uploadToken,
          "content-type": "application/octet-stream",
        },
        body: chunk2,
      }
    );
    expect(part2Res.status).toBe(200);
    const part2 = await part2Res.json<{ partNumber: number; etag: string }>();
    expect(part2.partNumber).toBe(2);

    // 4. Complete multipart merge
    const completeRes = await SELF.fetch("https://x/api/upload/multipart/complete", {
      method: "POST",
      headers: { ...T, "x-multipart-token": uploadToken, "content-type": "application/json" },
      body: JSON.stringify({
        id,
        uploadId,
        parts: [part1, part2],
      }),
    });
    expect(completeRes.status).toBe(200);
    const completed = await completeRes.json<{ id: string; size: number; origName: string }>();
    expect(completed.id).toBe(id);
    expect(completed.size).toBe(totalSize);
    expect(completed.origName).toBe("large_archive.zip");

    // 5. Verify the merged object via GET /i/<id> with Range request
    const getRes = await SELF.fetch(`https://x/i/${id}`, {
      headers: { ...T, range: "bytes=0-1" },
    });
    expect(getRes.status).toBe(206);
    expect(getRes.headers.get("content-range")).toBe(`bytes 0-1/${totalSize}`);
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
    const { id, uploadId, uploadToken } = await initRes.json<{
      id: string;
      uploadId: string;
      uploadToken: string;
    }>();

    const abortRes = await SELF.fetch("https://x/api/upload/multipart/abort", {
      method: "POST",
      headers: { ...T, "x-multipart-token": uploadToken, "content-type": "application/json" },
      body: JSON.stringify({ id, uploadId }),
    });
    expect(abortRes.status).toBe(200);
    expect((await abortRes.json<{ aborted: boolean }>()).aborted).toBe(true);
  });

  it("rejects invalid declared sizes and oversized parts", async () => {
    const malformedComplete = await SELF.fetch("https://x/api/upload/multipart/complete", {
      method: "POST",
      headers: { ...T, "content-type": "application/json" },
      body: "null",
    });
    expect(malformedComplete.status).toBe(400);

    const invalidSize = await SELF.fetch("https://x/api/upload/multipart/init", {
      method: "POST",
      headers: { ...T, "content-type": "application/json" },
      body: JSON.stringify({ filename: "bad.bin", size: 0 }),
    });
    expect(invalidSize.status).toBe(400);

    const tooLarge = await SELF.fetch("https://x/api/upload/multipart/init", {
      method: "POST",
      headers: { ...T, "content-type": "application/json" },
      body: JSON.stringify({ filename: "too-large.bin", size: 3 * 1024 * 1024 * 1024 + 1 }),
    });
    expect(tooLarge.status).toBe(413);

    const initRes = await SELF.fetch("https://x/api/upload/multipart/init", {
      method: "POST",
      headers: { ...T, "content-type": "application/json" },
      body: JSON.stringify({ filename: "wrong-size.bin", size: 10 }),
    });
    const { id, uploadId, uploadToken } = await initRes.json<{
      id: string;
      uploadId: string;
      uploadToken: string;
    }>();
    const missingToken = await SELF.fetch(
      `https://x/api/upload/multipart/part?id=${id}&uploadId=${encodeURIComponent(uploadId)}&partNumber=1`,
      {
        method: "PUT",
        headers: { ...T, "content-type": "application/octet-stream", "content-length": "10" },
        body: new Uint8Array(10),
      }
    );
    expect(missingToken.status).toBe(401);

    const decimalPart = await SELF.fetch(
      `https://x/api/upload/multipart/part?id=${id}&uploadId=${encodeURIComponent(uploadId)}&partNumber=1.5`,
      {
        method: "PUT",
        headers: {
          ...T,
          "x-multipart-token": uploadToken,
          "content-type": "application/octet-stream",
          "content-length": "10",
        },
        body: new Uint8Array(10),
      }
    );
    expect(decimalPart.status).toBe(400);

    const partRes = await SELF.fetch(
      `https://x/api/upload/multipart/part?id=${id}&uploadId=${encodeURIComponent(uploadId)}&partNumber=1`,
      {
        method: "PUT",
        headers: {
          ...T,
          "x-multipart-token": uploadToken,
          "content-type": "application/octet-stream",
          "content-length": "9",
        },
        body: new Uint8Array(9),
      }
    );
    expect(partRes.status).toBe(400);

    const abortRes = await SELF.fetch("https://x/api/upload/multipart/abort", {
      method: "POST",
      headers: { ...T, "x-multipart-token": uploadToken, "content-type": "application/json" },
      body: JSON.stringify({ id, uploadId }),
    });
    expect(abortRes.status).toBe(200);
  });
});
