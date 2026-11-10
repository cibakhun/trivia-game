import { createHash, randomBytes } from 'node:crypto';

/** Zufallstoken als Base64url ohne Auffüllung. */
export function randomToken(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

/** Länge eines Base64url-Tokens aus `bytes` Byte (ohne Auffüllung). */
export function tokenLength(bytes: number): number {
  return Math.ceil((bytes * 4) / 3);
}

/** Prüft die Form vor dem Dekodieren: Buffer.from überspringt ungültige Zeichen stillschweigend. */
export function isToken(value: unknown, bytes: number): value is string {
  return (
    typeof value === 'string' &&
    value.length === tokenLength(bytes) &&
    /^[A-Za-z0-9_-]+$/.test(value) &&
    Buffer.from(value, 'base64url').length === bytes
  );
}

/** SHA-256 der Token-Bytes; gespeichert wird nur dieser Hash (SECURITY.md §2). */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(Buffer.from(token, 'base64url')).digest();
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** JSON mit sortierten Schlüsseln, damit gleiche Inhalte gleiche Hashes ergeben. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
