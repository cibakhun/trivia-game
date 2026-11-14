import { useLayoutEffect, useMemo, useState, type CSSProperties, type RefObject } from 'react';
import { fxParticles, type FxBurst, type FxParticle } from './fx.ts';
import './fx.css';

/**
 * Ebene der Effekte über der Karte (ADR-070): Sie liegt im Rahmen der Karte, über dem SVG, nimmt
 * keine Tipps an und rechnet Karteneinheiten einmal beim Erscheinen in Bildpunkte um (und wieder,
 * wenn sich die Größe ändert). Ein neuer Anlass braucht einen neuen `key` am Element: Dann beginnt
 * alles von vorn. Ohne Animation (laufende Frage, „Bewegung reduzieren“) ist nichts zu sehen.
 */

interface Placement {
  /** Bildpunkte je Karteneinheit. */
  readonly scale: number;
  /** Lage des Kartenursprungs im Rahmen. */
  readonly x: number;
  readonly y: number;
}

/** Fliegende Teilchen brauchen drei Ebenen: waagrecht, Bogen, Drehung und Form. */
const FLYING = new Set(['shards', 'debris', 'splash']);

function measure(svg: SVGSVGElement, frame: HTMLElement): Placement | null {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const box = frame.getBoundingClientRect();
  return { scale: ctm.a, x: ctm.e - box.left, y: ctm.f - box.top };
}

export function FxLayer({
  svg,
  bursts,
}: {
  readonly svg: RefObject<SVGSVGElement | null>;
  readonly bursts: readonly FxBurst[];
}) {
  const [place, setPlace] = useState<Placement | null>(null);
  const particles = useMemo(() => bursts.flatMap(fxParticles), [bursts]);

  useLayoutEffect(() => {
    const element = svg.current;
    const frame = element?.parentElement;
    if (!element || !frame) return;
    const update = () => {
      const next = measure(element, frame);
      setPlace((now) =>
        next && (!now || now.scale !== next.scale || now.x !== next.x || now.y !== next.y)
          ? next
          : now,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [svg]);

  if (!place || particles.length === 0) return null;
  return (
    <div className="fx-layer" aria-hidden="true">
      {particles.map((p) => (
        <Particle key={p.key} particle={p} place={place} />
      ))}
    </div>
  );
}

const px = (n: number) => `${Math.round(n * 10) / 10}px`;

function Particle({
  particle: p,
  place,
}: {
  readonly particle: FxParticle;
  readonly place: Placement;
}) {
  const k = place.scale;
  const style: CSSProperties = {
    left: px(place.x + p.x * k),
    top: px(place.y + p.y * k),
    ['--s' as string]: px(p.size * k),
    ['--dx' as string]: px(p.dx * k),
    ['--dy' as string]: px(p.dy * k),
    ['--lift' as string]: px(p.lift * k),
    ['--rot' as string]: `${p.rot}deg`,
    ['--d' as string]: `${p.delayMs}ms`,
    ['--t' as string]: `${p.durationMs}ms`,
    ...(p.color ? { ['--c' as string]: p.color } : {}),
  };
  return (
    <span className={`fx-p fx-${p.kind} v${p.variant}`} style={style}>
      {FLYING.has(p.kind) ? (
        <i>
          <b />
        </i>
      ) : (
        <b />
      )}
    </span>
  );
}
