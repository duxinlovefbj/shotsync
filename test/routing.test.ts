import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const T = { authorization: "Bearer test-token" };

describe("routing end-to-end", () => {
  it("GET / returns html", async () => {
    const res = await SELF.fetch("https://x/");
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("upload -> list -> image -> delete full cycle", async () => {
    const fd = new FormData();
    fd.set("full", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), "s.png");
    const up = await SELF.fetch("https://x/api/upload", { method: "POST", headers: T, body: fd });
    expect(up.status).toBe(200);
    const { id } = await up.json<{ id: string }>();

    const list = await SELF.fetch("https://x/api/list", { headers: T });
    const body = await list.json<{ items: any[] }>();
    expect(body.items.some((i) => i.id === id)).toBe(true);

    const img = await SELF.fetch(`https://x/i/${id}`, { headers: T });
    expect(img.status).toBe(200);
    await img.arrayBuffer();

    const del = await SELF.fetch(`https://x/api/img/${id}`, { method: "DELETE", headers: T });
    expect(del.status).toBe(200);
    await del.json();

    const img2 = await SELF.fetch(`https://x/i/${id}`, { headers: T });
    expect(img2.status).toBe(404);
    await img2.json();
  });

  it("405 on wrong method", async () => {
    const res = await SELF.fetch("https://x/api/list", { method: "POST", headers: T });
    expect(res.status).toBe(405);
  });

  it("401 on missing token for api", async () => {
    const res = await SELF.fetch("https://x/api/list");
    expect(res.status).toBe(401);
  });

  it("unknown path returns 404", async () => {
    const res = await SELF.fetch("https://x/nope");
    expect(res.status).toBe(404);
    await res.json();
  });

  it("GET /api/health returns system info without auth", async () => {
    const res = await SELF.fetch("https://x/api/health");
    expect(res.status).toBe(200);
    const data = await res.json<{ ok: boolean; version: string; storage: string; maxUploadBytes: number }>();
    expect(data.ok).toBe(true);
    expect(data.version).toBe("1.1.0");
    expect(data.storage).toBe("r2");
    expect(data.maxUploadBytes).toBe(90 * 1024 * 1024);
  });

  it("supports /api/v1/* aliases", async () => {
    const health = await SELF.fetch("https://x/api/v1/health");
    expect(health.status).toBe(200);

    const list = await SELF.fetch("https://x/api/v1/list", { headers: T });
    expect(list.status).toBe(200);
  });

  it("serves manifest and sw", async () => {
    const mani = await SELF.fetch("https://x/manifest.webmanifest");
    expect(mani.status).toBe(200);
    expect(mani.headers.get("content-type")).toContain("manifest");
    const sw = await SELF.fetch("https://x/sw.js");
    expect(sw.status).toBe(200);
    expect(sw.headers.get("content-type")).toContain("javascript");
  });
});
