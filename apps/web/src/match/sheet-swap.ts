import type { DuelScene } from './match-model.ts';

/**
 * Blätter mitten auf der Karte und ihre Wechsel (docs/ART_DIRECTION.md §5).
 *
 * Die Fragekarte steht ohne Bewegung da, solange geantwortet wird. Kommt die Auflösung, dreht sich
 * die Karte um: vorn die Frage, hinten die Antworten. Geht die Auflösung, hebt sie sich von der
 * Karte ab. Alle anderen Wechsel sind harte Schnitte: Vor einer Frage darf sich nichts bewegen,
 * und das Rad bringt seine eigene Bewegung mit.
 */
export type SheetKind = 'question' | 'wheel' | 'reveal' | 'result' | 'closed';

/** `turn`: Das alte Blatt dreht sich weg, das neue herein. `lift`: Das alte hebt sich ab. */
export type SheetSwap = 'turn' | 'lift';

export function sheetSwap(from: SheetKind | null, to: SheetKind | null): SheetSwap | null {
  if (from === 'question' && to === 'reveal') return 'turn';
  if (from === 'reveal' && to !== 'reveal' && to !== 'question') return 'lift';
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
