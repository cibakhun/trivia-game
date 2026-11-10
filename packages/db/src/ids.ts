import { randomBytes } from 'node:crypto';

/**
 * IDs fachlicher Entitäten: UUIDv7 nach RFC 9562 §5.7, in der Anwendung erzeugt
 * (DATA_MODEL §1). 48 Bit Unix-Millisekunden, Version 7, 74 Bit Zufall: über Millisekunden
 * hinweg sortierbar, innerhalb derselben Millisekunde zufällig geordnet. Neue Zeilen landen deshalb
 * nahe am Ende des B-Baums (gute Lokalität), aber nicht garantiert ganz am Ende.
 */
export function newId(now: number = Date.now()): string {
  if (!Number.isInteger(now) || now < 0 || now >= 2 ** 48) {
    throw new RangeError(`Zeitpunkt außerhalb von UUIDv7: ${now}`);
  }
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f); // Version 7
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f); // Variante 10
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
