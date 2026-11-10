import { useEffect, useRef, useState } from 'react';

/**
 * Zahl, die bei Änderungen kurz hoch- oder herunterzählt (0,7 s). Mit „Bewegung reduzieren“ und
 * beim ersten Anzeigen steht sofort der Endwert.
 */
export function CountUp({
  value,
  render,
  durationMs = 700,
}: {
  readonly value: number;
  readonly render: (value: number) => string;
  readonly durationMs?: number;
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
    const began = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - began) / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      setShown(Math.round(start + (value - start) * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      setShown(value);
    };
  }, [value, durationMs]);

  return <span className={shown === value ? undefined : 'counting'}>{render(shown)}</span>;
}
