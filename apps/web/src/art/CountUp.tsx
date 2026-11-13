import { useEffect, useRef, useState } from 'react';

/**
 * Zahl, die bei Änderungen kurz hoch- oder herunterzählt (0,7 s). Mit „Bewegung reduzieren“ und
 * beim ersten Anzeigen steht sofort der Endwert. `delayMs`: Die alte Zahl bleibt so lange stehen
 * (etwa bis das Einkommen im Vorrat ankommt). `steady`: gleichmäßig zählen statt auslaufend, wenn
 * die Zahl mit etwas mitläuft, das Stück für Stück ankommt.
 */
export function CountUp({
  value,
  render,
  durationMs = 700,
  delayMs = 0,
  steady = false,
}: {
  readonly value: number;
  readonly render: (value: number) => string;
  readonly durationMs?: number;
  readonly delayMs?: number;
  readonly steady?: boolean;
}) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const start = from.current;
    from.current = value;
    const still =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (start === value || still) {
      setShown(value);
      return;
    }
    const began = performance.now() + delayMs;
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - began) / durationMs));
      const eased = steady ? progress : 1 - (1 - progress) ** 3;
      setShown(Math.round(start + (value - start) * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      setShown(value);
    };
  }, [value, durationMs, delayMs, steady]);

  return <span className={shown === value ? undefined : 'counting'}>{render(shown)}</span>;
}
