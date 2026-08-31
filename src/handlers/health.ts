import { Env, json, MAX_UPLOAD_BYTES } from "../responses";

export async function handleHealth(_request: Request, env: Env): Promise<Response> {
  return json({
    ok: true,
    version: "1.0.0",
    storage: "r2",
    maxUploadBytes: MAX_UPLOAD_BYTES,
    serverTime: Date.now(),
    demoMode: env.DEMO_MODE === "1",
  });
}
