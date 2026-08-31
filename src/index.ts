import { Env, err } from "./responses";
import { handleHealth } from "./handlers/health";
import { handleUpload } from "./handlers/upload";
import { handleList } from "./handlers/list";
import { handleImage } from "./handlers/image";
import { handleDelete } from "./handlers/del";
import { handleShareCreate, handleSharedItem } from "./handlers/share";
import { galleryDemoHTML, galleryHTML } from "./gallery/page";
import { manifestJSON } from "./gallery/manifest";
import { swJS } from "./gallery/sw";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const m = request.method;

    if (pathname === "/" && m === "GET") {
      // On the demo deployment, flip the frontend into read-only demo chrome.
      const html = env.DEMO_MODE === "1" ? galleryDemoHTML : galleryHTML;
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (pathname === "/manifest.webmanifest" && m === "GET") {
      return new Response(manifestJSON, { headers: { "content-type": "application/manifest+json" } });
    }
    if (pathname === "/sw.js" && m === "GET") {
      return new Response(swJS, { headers: { "content-type": "text/javascript" } });
    }

    // Health check endpoint (public probe)
    if ((pathname === "/api/health" || pathname === "/api/v1/health") && m === "GET") {
      return handleHealth(request, env);
    }

    // Upload endpoint (with v1 alias)
    if (pathname === "/api/upload" || pathname === "/api/v1/upload") {
      return m === "POST" ? handleUpload(request, env) : err(405, "method not allowed");
    }

    // List endpoint (with v1 alias)
    if (pathname === "/api/list" || pathname === "/api/v1/list") {
      return m === "GET" ? handleList(request, env) : err(405, "method not allowed");
    }

    if (pathname.startsWith("/i/")) {
      const id = decodeURIComponent(pathname.slice("/i/".length));
      return m === "GET" ? handleImage(request, env, id) : err(405, "method not allowed");
    }
    if (pathname.startsWith("/api/img/") || pathname.startsWith("/api/v1/img/")) {
      const prefix = pathname.startsWith("/api/v1/img/") ? "/api/v1/img/" : "/api/img/";
      const id = decodeURIComponent(pathname.slice(prefix.length));
      return m === "DELETE" ? handleDelete(request, env, id) : err(405, "method not allowed");
    }
    if (pathname.startsWith("/api/share/") || pathname.startsWith("/api/v1/share/")) {
      const prefix = pathname.startsWith("/api/v1/share/") ? "/api/v1/share/" : "/api/share/";
      const id = decodeURIComponent(pathname.slice(prefix.length));
      return m === "POST" ? handleShareCreate(request, env, id) : err(405, "method not allowed");
    }
    if (pathname.startsWith("/s/")) {
      const id = decodeURIComponent(pathname.slice("/s/".length));
      return m === "GET" ? handleSharedItem(request, env, id) : err(405, "method not allowed");
    }
    return err(404, "not found");
  },
} satisfies ExportedHandler<Env>;
