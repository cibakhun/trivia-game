import { hash, verify } from '@node-rs/argon2';

/**
 * Passwörter (SECURITY.md §2, ADR-043): Argon2id mit den Mindestwerten der OWASP-Empfehlung
 * (19 MiB Speicher, 2 Durchläufe, 1 Faden). `@node-rs/argon2` nutzt Argon2id als Standard und
 * rechnet außerhalb der Ereignisschleife. Der Hash trägt Verfahren, Parameter und Salz selbst;
 * stärkere Parameter später gelten für neue Hashes, alte bleiben prüfbar.
 */
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export async function hashPassword(password: string): Promise<string> {
  const result = await hash(password, OPTIONS);
  // Die Datenbank prüft dasselbe (users_password_argon2id); hier fällt ein falscher Standard früher auf.
  if (!result.startsWith('$argon2id$')) throw new Error('Passwort-Hash ist nicht Argon2id');
  return result;
}

/** Hash zu einem zufälligen Passwort: gleicher Aufwand bei unbekanntem Benutzernamen. */
let dummyHash: Promise<string> | null = null;

/**
 * Prüft ein Passwort. Ohne gespeicherten Hash (unbekannter Benutzer) wird gegen einen festen
 * Hash gerechnet, damit die Antwortzeit nicht verrät, ob es den Namen gibt.
 */
export async function verifyPassword(stored: string | null, password: string): Promise<boolean> {
  if (stored === null) {
    dummyHash ??= hash(crypto.randomUUID(), OPTIONS);
    await verify(await dummyHash, password).catch(() => false);
    return false;
  }
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}
