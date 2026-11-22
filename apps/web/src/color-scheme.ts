/**
 * Nachtkarte: dunkles Papier und helle Tinte im dunklen Systemmodus (docs/ART_DIRECTION.md).
 * Seit 2026-11-15 auf Wunsch des Product Owners abgeschaltet („wir machen erstmal nur hell modus“,
 * ADR-073): Das Spiel zeigt immer die Tagkarte. Die Farben der Nacht bleiben in `theme.css` und
 * greifen nur unter `<html data-night="auto">`; `true` schaltet sie wieder ein.
 */
export const NIGHT_MAP_ENABLED: boolean = false;

/**
 * Setzt beim Start, ob die Seite dem dunklen Systemmodus folgt. Ohne Nachtkarte bleibt alles, wie
 * `index.html` und `theme.css` es vorgeben: nur hell, auch gegen eine erzwungene Abdunklung.
 */
export function applyColorScheme(doc: Document, night: boolean = NIGHT_MAP_ENABLED): void {
  if (!night) return;
  doc.documentElement.dataset.night = 'auto';
  doc.querySelector('meta[name="color-scheme"]')?.setAttribute('content', 'light dark');
}
