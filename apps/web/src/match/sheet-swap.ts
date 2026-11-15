import type { DuelScene } from './match-model.ts';

/**
 * Blätter mitten auf der Karte und ihre Wechsel (docs/ART_DIRECTION.md §5).
 *
 * Die Fragekarte steht ohne Bewegung da, solange geantwortet wird. Kommt die Auflösung einer
 * Wissensfrage, bleibt die Karte liegen (ADR-070 Punkt 10): Die Auflösung hat denselben Aufbau und
 * legt sich an dieselbe Stelle, nur was neu ist, kommt dazu (Schild, Stempel, Farben). Bei einer
 * Schätzfrage dreht sich die Karte um, denn hinten steht anderes als vorn: statt des Felds für die
 * eigene Zahl die Lösung und die Rangfolge. Geht die Auflösung, hebt sie sich von der Karte ab.
 * Alle anderen Wechsel sind harte Schnitte: Vor einer Frage darf sich nichts bewegen, und das Rad
 * bringt seine eigene Bewegung mit.
 */
export type SheetKind = 'question' | 'wheel' | 'reveal' | 'result' | 'closed';

/** Art der Frage auf einer Fragekarte oder Auflösung. */
export type SheetFace = 'TRIVIA' | 'ESTIMATE';

/** Ein Blatt in der Mitte: welches, und bei Frage und Auflösung, zu welcher Art von Frage. */
export interface Sheet {
  readonly kind: SheetKind | null;
  readonly face?: SheetFace | null;
}

/**
 * `stay`: Das neue Blatt legt sich auf das alte, das darunter geht. `turn`: Das alte Blatt dreht
 * sich weg, das neue herein. `lift`: Das alte hebt sich ab.
 */
export type SheetSwap = 'stay' | 'turn' | 'lift';

export function sheetSwap(from: Sheet, to: Sheet): SheetSwap | null {
  if (from.kind === 'question' && to.kind === 'reveal') {
    return from.face === 'TRIVIA' && to.face === 'TRIVIA' ? 'stay' : 'turn';
  }
  if (from.kind === 'reveal' && to.kind !== 'reveal' && to.kind !== 'question') return 'lift';
  return null;
}

/**
 * Schleier unter einem Blatt. Zeigt die Karte ein Duell, tritt sie schon selbst zurück (alles außer
 * den zwei Feldern liegt im Dunkeln), vom Aufmarsch bis zum Ausgang: Darüber braucht ein Blatt
 * keinen zweiten Schleier, und zwischen Rad, Frage, Auflösung und Ausgang wechselt die Helligkeit
 * der Karte nicht. `cut` heißt: sofort da, weil eine Frage beginnt.
 */
export function sheetVeil(
  sheet: SheetKind | null,
  scene: DuelScene | null,
): { readonly on: boolean; readonly cut: boolean } {
  const dimmed = scene !== null && scene !== 'settled';
  return { on: sheet !== null && !dimmed, cut: sheet === 'question' || sheet === 'wheel' };
}
