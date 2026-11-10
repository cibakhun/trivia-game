/**
 * Auditierbarer Zufall (docs/ARCHITECTURE.md §9):
 *
 *     seed = HMAC-SHA256(RNG_SECRET[key_id], purpose + ":" + entity_id)
 *     rng  = sfc32(seed)
 *
 * Gleiche Eingaben liefern immer dieselbe Folge (Wiederholungen würfeln nicht neu); ohne das
 * Geheimnis ist die Folge nicht vorhersagbar. Jede Änderung an Ableitung, Generator oder
 * Ziehungsreihenfolge erhöht `RNG_VERSION`, damit alte Protokolle nachrechenbar bleiben.
 */

/** Version des Verfahrens; wird mit jedem Wurf im Ereignisprotokoll gespeichert. */
export const RNG_VERSION = 1;

/**
 * `match`: Sitzverteilung, Wahlen nach Zeitablauf und Bot-Wahlen einer Partie
 * (docs/MATCH_RULES.md §7); die Bot-Antworten kommen wie im PvE aus `npc-answer`.
 */
export const RNG_PURPOSES = ['npc-answer', 'drop', 'question-pick', 'spawn', 'match'] as const;
export type RngPurpose = (typeof RNG_PURPOSES)[number];

/** Entitäts-IDs sind UUIDs oder Zahlen; ASCII hält die Ableitung ohne Textkodierung eindeutig. */
const ENTITY_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/** Zahl der verworfenen Startwerte („Aufwärmen“ von sfc32). */
const WARMUP_ROUNDS = 12;
const TWO_POW_32 = 4_294_967_296;

/** Ausschnitt aus WebCrypto, der in Browsern und Node ≥ 20 als `globalThis.crypto` existiert. */
interface SubtleCryptoSubset {
  importKey(
    format: 'raw',
    keyData: Uint8Array,
    algorithm: { name: 'HMAC'; hash: 'SHA-256' },
    extractable: false,
    usages: ['sign'],
  ): Promise<unknown>;
  sign(algorithm: 'HMAC', key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
}

function subtleCrypto(): SubtleCryptoSubset {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCryptoSubset } }).crypto?.subtle;
  if (!subtle)
    throw new Error('WebCrypto (crypto.subtle) ist in dieser Laufzeitumgebung nicht verfügbar');
  return subtle;
}

/** Seed für einen Zufallsstrom: HMAC-SHA256 über `purpose:entityId` (32 Byte). */
export async function deriveSeed(
  secret: Uint8Array,
  purpose: RngPurpose,
  entityId: string,
): Promise<Uint8Array> {
  if (secret.length < 32) throw new RangeError('RNG-Geheimnis muss mindestens 32 Byte haben');
  if (!ENTITY_ID_PATTERN.test(entityId)) {
    throw new RangeError('entityId muss 1–128 Zeichen aus [A-Za-z0-9._-] haben');
  }
  const subtle = subtleCrypto();
  const key = await subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const text = `${purpose}:${entityId}`;
  const message = Uint8Array.from(text, (ch) => ch.charCodeAt(0)); // reines ASCII, siehe Muster
  return new Uint8Array(await subtle.sign('HMAC', key, message));
}

/** Deterministischer Zufallsstrom. */
export interface Rng {
  /** Gleichverteilte ganze Zahl in [0, 2^32). */
  nextUint32(): number;
  /** Gleichverteilte Zahl in [0, 1) mit 32-Bit-Auflösung (`nextUint32() / 2^32`, exakt). */
  nextFloat(): number;
  /**
   * Standardnormalverteilte Zahl (Box-Muller). Verbraucht immer genau zwei Werte des Stroms,
   * damit die Ziehungsreihenfolge fest bleibt. Anders als `nextUint32`/`nextFloat` ist das
   * Ergebnis nicht bitgenau zwischen Engines: ECMAScript legt `Math.log` und `Math.cos` nur
   * näherungsweise fest. Maßgeblich ist der Server, der Ergebnis und Ziehungen protokolliert.
   */
  nextNormal(): number;
}

/** sfc32 („Small Fast Counting“, Chris Doty-Humphrey, PractRand) auf vier 32-Bit-Zuständen. */
function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
}

/** Zufallsstrom aus einem Seed; verwendet die ersten 16 Byte (vier Wörter, Big Endian). */
export function createRng(seed: Uint8Array): Rng {
  if (seed.length < 16) throw new RangeError('Seed muss mindestens 16 Byte haben');
  const view = new DataView(seed.buffer, seed.byteOffset, seed.byteLength);
  const next = sfc32(view.getUint32(0), view.getUint32(4), view.getUint32(8), view.getUint32(12));
  for (let i = 0; i < WARMUP_ROUNDS; i++) next();

  const nextFloat = () => next() / TWO_POW_32;
  return {
    nextUint32: next,
    nextFloat,
    nextNormal: () => {
      const u1 = 1 - nextFloat(); // (0, 1]: log(0) ausgeschlossen
      const u2 = nextFloat();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    },
  };
}
