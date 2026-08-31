export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Source, X-Filename, X-Multipart-Token, Range",
  "Access-Control-Expose-Headers": "Content-Disposition, Content-Range, Content-Length, Accept-Ranges, ETag",
  "Access-Control-Max-Age": "86400",
};

/**
 * Handle OPTIONS preflight requests directly with 204 No Content and CORS headers
 */
export function handleCorsPreflight(_request?: Request): Response {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

/**
 * Attach CORS headers to any outgoing Response (2xx, 4xx, 5xx)
 */
export function applyCors(response: Response, _request?: Request): Response {
  // If response is already immutable or constructed, clone headers and set CORS headers
  const headers = new Headers(response.headers);
  for (const [key, val] of Object.entries(CORS_HEADERS)) {
    headers.set(key, val);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
