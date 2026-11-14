import { useEffect, useRef, useState } from 'react';

/**
 * Zahl, die bei Änderungen kurz hoch- oder herunterzählt (0,7 s). Mit „Bewegung reduzieren“ und
 * beim ersten Anzeigen steht sofort der Endwert. `delayMs`: Die alte Zahl bleibt so lange stehen
 * (etwa bis das Einkommen im Vorrat ankommt), und erst wenn sie zu zählen beginnt, trägt sie die
 * Klasse `counting`. `steady`: gleichmäßig zählen statt auslaufend, wenn die Zahl mit etwas
 * mitläuft, das Stück für Stück ankommt. `from`: Mit diesem Wert erscheint die Zahl und zählt von
 * dort zum Endwert (ein Vorrat, der mit dem Blatt erscheint, während sein Zuwachs noch unterwegs
 * ist). Ändert sich der Endwert mitten im Zählen, geht es vom gerade gezeigten Wert weiter: Die
 * Zahl springt nie.
 */
export function CountUp({
  value,
  render,
  durationMs = 700,
  delayMs = 0,
  steady = false,
  from,
}: {
  readonly value: number;
  readonly render: (value: number) => string;
  readonly durationMs?: number;
  readonly delayMs?: number;
  readonly steady?: boolean;
  readonly from?: number;
}) {
  const [shown, setShown] = useState(from ?? value);
  // Wartet die alte Zahl noch auf ihren Beginn, zählt sie noch nicht
  const [waiting, setWaiting] = useState(false);
  // Was gerade zu sehen ist: Von dort zählt die nächste Änderung weiter
  const seen = useRef(from ?? value);

  useEffect(() => {
    const start = seen.current;
    const still =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (start === value || still) {
      seen.current = value;
      setShown(value);
      setWaiting(false);
      return;
    }
    const began = performance.now() + delayMs;
    setWaiting(delayMs > 0);
    let frame = 0;
    const tick = (now: number) => {
      if (now < began) {
        frame = requestAnimationFrame(tick);
        return;
      }
      setWaiting(false);
      const progress = Math.min(1, Math.max(0, (now - began) / durationMs));
      const eased = steady ? progress : 1 - (1 - progress) ** 3;
      const next = Math.round(start + (value - start) * eased);
      seen.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      setWaiting(false);
    };
  }, [value, durationMs, delayMs, steady]);

  return (
    <span className={shown === value || waiting ? undefined : 'counting'}>{render(shown)}</span>
  );
}
