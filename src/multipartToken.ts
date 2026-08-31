export interface MultipartTicket {
  id: string;
  uploadId: string;
  size: number;
  chunkSize: number;
  exp: number;
}

const TICKET_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();

function base64UrlEncode(value: string): string {
  const bytes = encoder.encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): string | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function hexToBytes(value: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function keyFor(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function createMultipartTicket(
  ticket: Omit<MultipartTicket, "exp">,
  secret: string
): Promise<string> {
  const payload = base64UrlEncode(JSON.stringify({ ...ticket, exp: Date.now() + TICKET_TTL_MS }));
  const mac = await crypto.subtle.sign("HMAC", await keyFor(secret), encoder.encode(payload));
  const signature = Array.from(new Uint8Array(mac), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${payload}.${signature}`;
}

export async function verifyMultipartTicket(
  token: string,
  secret: string,
  id: string,
  uploadId: string
): Promise<MultipartTicket | null> {
  const tokenParts = token.split(".");
  if (tokenParts.length !== 2) return null;
  const [payload, signature] = tokenParts;
  if (!payload || !signature) return null;

  const signatureBytes = hexToBytes(signature);
  if (!signatureBytes) return null;

  const valid = await crypto.subtle.verify(
    "HMAC",
    await keyFor(secret),
    signatureBytes,
    encoder.encode(payload)
  );
  if (!valid) return null;

  const decoded = base64UrlDecode(payload);
  if (!decoded) return null;

  try {
    const value = JSON.parse(decoded) as Partial<MultipartTicket>;
    const size = value.size;
    const chunkSize = value.chunkSize;
    const exp = value.exp;
    if (
      value.id !== id ||
      value.uploadId !== uploadId ||
      typeof value.id !== "string" ||
      typeof value.uploadId !== "string" ||
      typeof size !== "number" ||
      !Number.isSafeInteger(size) ||
      size <= 0 ||
      typeof chunkSize !== "number" ||
      !Number.isSafeInteger(chunkSize) ||
      chunkSize <= 0 ||
      typeof exp !== "number" ||
      !Number.isSafeInteger(exp) ||
      Date.now() >= exp
    ) return null;

    return value as MultipartTicket;
  } catch {
    return null;
  }
}
