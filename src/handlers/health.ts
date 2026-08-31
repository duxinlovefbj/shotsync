import {
  Env,
  json,
  MAX_SINGLE_UPLOAD_BYTES,
  MAX_TOTAL_FILE_BYTES,
  RECOMMENDED_CHUNK_SIZE_BYTES,
  LARGE_FILE_THRESHOLD_BYTES,
  LARGE_FILE_MAX_SHARE_TTL_SEC
} from "../responses";

export async function handleHealth(_request: Request, env: Env): Promise<Response> {
  return json({
    ok: true,
    version: "1.1.0",
    storage: "r2",
    maxUploadBytes: MAX_SINGLE_UPLOAD_BYTES, // legacy compatibility field
    maxSingleUploadBytes: MAX_SINGLE_UPLOAD_BYTES,
    maxTotalFileBytes: MAX_TOTAL_FILE_BYTES,
    recommendedChunkSizeBytes: RECOMMENDED_CHUNK_SIZE_BYTES,
    largeFileThresholdBytes: LARGE_FILE_THRESHOLD_BYTES,
    largeFileMaxShareTtlSec: LARGE_FILE_MAX_SHARE_TTL_SEC,
    features: {
      rangeRequests: true,
      multipartUpload: true,
    },
    serverTime: Date.now(),
    demoMode: env.DEMO_MODE === "1",
  });
}
