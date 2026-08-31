import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const T = { authorization: "Bearer test-token" };

describe("CORS support", () => {
  const routesToTest = [
    { method: "GET", path: "/api/list" },
    { method: "POST", path: "/api/upload" },
    { method: "POST", path: "/api/upload/multipart/init" },
    { method: "PUT", path: "/api/upload/multipart/part" },
    { method: "POST", path: "/api/upload/multipart/complete" },
    { method: "POST", path: "/api/upload/multipart/abort" },
    { method: "DELETE", path: "/api/img/test-id" },
    { method: "POST", path: "/api/share/test-id" },
    { method: "GET", path: "/api/health" },
    { method: "GET", path: "/i/test-id" },
    { method: "GET", path: "/s/test-id" },
  ];

  for (const { method, path } of routesToTest) {
    it(`OPTIONS ${path} preflight returns 204 with CORS headers for ${method}`, async () => {
      const res = await SELF.fetch(`https://x${path}`, {
        method: "OPTIONS",
        headers: {
          origin: "http://192.168.2.100:8765",
          "access-control-request-method": method,
          "access-control-request-headers": "authorization,content-type,x-multipart-token,x-source,x-filename",
        },
      });

      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("access-control-allow-methods")).toContain(method);
      expect(res.headers.get("access-control-allow-headers")).toContain("Authorization");
      expect(res.headers.get("access-control-allow-headers")).toContain("X-Multipart-Token");
      expect(res.headers.get("access-control-max-age")).toBe("86400");
    });
  }

  it("401 error response includes CORS headers", async () => {
    const res = await SELF.fetch("https://x/api/list", {
      headers: { origin: "http://192.168.1.50:3000" },
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const data = await res.json<{ error: { code: string; message: string } }>();
    expect(data.error.code).toBe("AUTH_REQUIRED");
  });

  it("404 error response includes CORS headers", async () => {
    const res = await SELF.fetch("https://x/api/nonexistent-route", {
      headers: { ...T, origin: "http://localhost:5173" },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    await res.json();
  });

  it("405 error response includes CORS headers", async () => {
    const res = await SELF.fetch("https://x/api/list", {
      method: "POST",
      headers: { ...T, origin: "http://127.0.0.1:8080" },
    });
    expect(res.status).toBe(405);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    await res.json();
  });

  it("200 success response includes CORS and Expose-Headers", async () => {
    const res = await SELF.fetch("https://x/api/health", {
      headers: { origin: "http://192.168.1.100:8765" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-expose-headers")).toContain("Content-Range");
    expect(res.headers.get("access-control-expose-headers")).toContain("ETag");
    await res.json();
  });
});
