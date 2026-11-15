import { useState } from 'react';

/**
 * Hauptstadtleben als kleine Schilde in Sitzfarbe (Farbe kommt von `.seat-N` am Elternelement);
 * verlorene Leben bleiben als blasse Schilde stehen. Für Screenreader zählt nur das Label. Geht
 * ein Leben verloren, während die Schilde stehen, trägt das eben verlorene `lost`: Auf den Tafeln
 * der Bühne springt es kurz auf und läuft leer (stage.css). Was schon beim Erscheinen fehlte,
 * bleibt still.
 */
export function LifeShields({
  left,
  max,
  label,
}: {
  readonly left: number;
  readonly max: number;
  readonly label: string;
}) {
  // Die Schilde des jüngsten Verlusts: von `left` bis vor `lostTo` (Merken während des Renderns)
  const [seen, setSeen] = useState({ left, lostTo: 0 });
  let lostTo = seen.lostTo;
  if (seen.left !== left) {
    lostTo = left < seen.left ? seen.left : 0;
    setSeen({ left, lostTo });
  }
  return (
    <span className="seat-lives" role="img" aria-label={label}>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={`${i}-${i < left ? 'on' : 'off'}`}
          className={i < left ? 'life-on' : i < lostTo ? 'life-off lost' : 'life-off'}
        />
      ))}
    </span>
  );
}
