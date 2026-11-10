/**
 * Hauptstadtleben als kleine Schilde in Sitzfarbe (Farbe kommt von `.seat-N` am Elternelement);
 * verlorene Leben bleiben als blasse Schilde stehen. Für Screenreader zählt nur das Label.
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
  return (
    <span className="seat-lives" role="img" aria-label={label}>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={`${i}-${i < left ? 'on' : 'off'}`}
          className={i < left ? 'life-on' : 'life-off'}
        />
      ))}
    </span>
  );
}
