import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { stageFrame, type StageFrame } from '../art/stage-frame.ts';

/** Abstand des Landes zu den Rändern links und rechts und zum oberen und unteren Bildschirmrand. */
const GAP_X = 8;
const GAP_Y = 5;

/**
 * Misst die Bühne der Partie und legt die Karte so, dass das Land zwischen den Rand links
 * (`data-stage-rail="left"`, Spielstand) und den Rand rechts (`data-stage-rail="right"`, Blatt)
 * passt. Beide Ränder sind immer gleich breit, also ändert sich der Ausschnitt nur, wenn sich der
 * Bildschirm ändert (Drehen, Fenstergröße, Leiste des Browsers).
 */
export function useStageFrame(land: string | null): {
  readonly stage: RefObject<HTMLElement | null>;
  readonly frame: StageFrame | null;
} {
  const stage = useRef<HTMLElement | null>(null);
  const [frame, setFrame] = useState<StageFrame | null>(null);

  useLayoutEffect(() => {
    const element = stage.current;
    if (!element || land === null) return;
    const rails = [
      element.querySelector('[data-stage-rail="left"]'),
      element.querySelector('[data-stage-rail="right"]'),
    ] as const;
    const measure = () => {
      const box = element.getBoundingClientRect();
      const left = rails[0]?.getBoundingClientRect();
      const right = rails[1]?.getBoundingClientRect();
      const next = stageFrame(
        land,
        {
          x0: (left ? left.right - box.left : 0) + GAP_X,
          x1: (right ? right.left - box.left : box.width) - GAP_X,
          y0: GAP_Y,
          y1: box.height - GAP_Y,
        },
        box.width,
        box.height,
      );
      setFrame((current) => (current?.viewBox === next?.viewBox ? current : next));
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    // Die Ränder ändern ihre Breite mit dem Maß der Bühne, auch wenn die Bühne gleich groß bleibt
    for (const rail of rails) if (rail) observer?.observe(rail);
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [land]);

  return { stage, frame };
}
