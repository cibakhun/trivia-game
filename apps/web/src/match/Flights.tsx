import {
  Fragment,
  useLayoutEffect,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';

/**
 * Zeichen, die einmal über die Bühne fliegen (ADR-067): Brot und Baustoff von den Feldern in den
 * Vorrat, die Kategorie vom Rad ins Blatt. Start und Ziel sind Elemente der Bühne; gemessen wird
 * einmal, wenn der Flug beginnt. Das Ziel zählt dabei an seinem Platz im Layout: Blendet sein Blatt
 * gerade mit einer kleinen Verschiebung ein, landet das Zeichen trotzdem dort, wo es dann steht. Jedes Zeichen springt mit einem kleinen Ring ab und zieht ein, zwei
 * goldene Glanzpunkte hinter sich her, die denselben Bogen etwas später fliegen (ADR-070). Die
 * Ebene nimmt keine Tipps an und verschiebt nichts. Ohne Animation (laufende Frage, „Bewegung
 * reduzieren“) bleibt sie unsichtbar: Das Endbild steht schon.
 */
export interface FlightPlan {
  readonly key: string;
  /** Start und Ziel als Selektoren innerhalb der Bühne. */
  readonly from: string;
  readonly to: string;
  readonly icon: ReactNode;
  /** Rang im Abflug; gleiche Ränge fliegen zusammen. */
  readonly order?: number;
  /** Versatz des Starts nach rechts in Pixeln: Zwei Zeichen vom selben Feld liegen nebeneinander. */
  readonly shift?: number;
  /**
   * Höhe des Bogens in Einheiten der Bühne, wenn er höher sein soll als üblich: So kommt ein
   * Zeichen von oben auf sein Ziel, statt über das zu fliegen, was links davon steht.
   */
  readonly lift?: number;
}

interface Flight {
  readonly key: string;
  readonly icon: ReactNode;
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;
  readonly span: number;
  readonly lift: number | null;
}

/** Ab so vielen Zeichen zieht jedes nur noch einen Glanzpunkt nach: Es soll ruhig bleiben. */
const BUSY = 10;

/** Glanzpunkte hinter einem Zeichen: die Scheibe vom Rad drei, Plättchen zwei, viele nur einen. */
export function flightTrail(tone: 'token' | 'coin', count: number): number {
  if (tone === 'coin') return 3;
  return count > BUSY ? 1 : 2;
}

interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function centre(box: Box): { x: number; y: number } {
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

/**
 * Wo ein Element der Bühne nach dem Layout steht, ohne laufende Verschiebung (`transform`) von ihm
 * oder dem Blatt, in dem es liegt. Ein Zeichen (SVG) zählt mit seiner Lage in dem Element, das es
 * trägt. `null`, wenn sich das nicht bis zur Bühne zurückrechnen lässt (Teil der Karte): Dann gilt,
 * was gerade zu sehen ist.
 */
export function restBox(element: Element, stage: HTMLElement, origin: Box): Box | null {
  if (!(element instanceof HTMLElement)) {
    const host = element.parentElement;
    if (!(host instanceof HTMLElement) || !stage.contains(host) || host === stage) return null;
    const rest = restBox(host, stage, origin);
    if (!rest) return null;
    const inner = element.getBoundingClientRect();
    const outer = host.getBoundingClientRect();
    return {
      left: rest.left + (inner.left - outer.left),
      top: rest.top + (inner.top - outer.top),
      width: inner.width,
      height: inner.height,
    };
  }
  let left = stage.clientLeft;
  let top = stage.clientTop;
  let node: HTMLElement = element;
  while (node !== stage) {
    const parent = node.offsetParent;
    if (!(parent instanceof HTMLElement)) return null;
    left += node.offsetLeft;
    top += node.offsetTop;
    if (parent !== stage) {
      left += parent.clientLeft - parent.scrollLeft;
      top += parent.clientTop - parent.scrollTop;
    }
    node = parent;
  }
  return {
    left: origin.left + left,
    top: origin.top + top,
    width: element.offsetWidth,
    height: element.offsetHeight,
  };
}

export function Flights({
  stage,
  plans,
  startMs,
  flightMs,
  staggerMs,
  nearestFirst = false,
  tone = 'token',
}: {
  readonly stage: RefObject<HTMLElement | null>;
  readonly plans: readonly FlightPlan[];
  /** Wartezeit vor dem ersten Abflug. */
  readonly startMs: number;
  readonly flightMs: number;
  /** Abstand zwischen zwei Abflügen. */
  readonly staggerMs: number;
  /** Die kürzesten Wege zuerst: Die Zeichen kommen als Welle an. */
  readonly nearestFirst?: boolean;
  /** `token`: kleines Plättchen aus Papier; `coin`: größere Scheibe mit goldenem Rand (Rad). */
  readonly tone?: 'token' | 'coin';
}) {
  const [flights, setFlights] = useState<readonly Flight[]>([]);

  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const origin = element.getBoundingClientRect();
    const measured = plans.flatMap((plan): Flight[] => {
      const from = element.querySelector(plan.from)?.getBoundingClientRect();
      const target = element.querySelector(plan.to);
      if (!from || !target) return [];
      const a = centre(from);
      const b = centre(restBox(target, element, origin) ?? target.getBoundingClientRect());
      return [
        {
          key: plan.key,
          icon: plan.icon,
          x: a.x - origin.left + (plan.shift ?? 0),
          y: a.y - origin.top,
          dx: b.x - a.x - (plan.shift ?? 0),
          dy: b.y - a.y,
          span: plan.order ?? 0,
          lift: plan.lift ?? null,
        },
      ];
    });
    const sorted = nearestFirst
      ? [...measured]
          .sort((p, q) => Math.hypot(p.dx, p.dy) - Math.hypot(q.dx, q.dy))
          .map((flight, index) => ({ ...flight, span: index }))
      : measured;
    setFlights(sorted);
  }, [stage, plans, nearestFirst]);

  if (flights.length === 0) return null;
  const trail = flightTrail(tone, flights.length);
  return (
    <div
      className={`flight-layer tone-${tone}`}
      style={{ ['--flight-ms' as string]: `${flightMs}ms` }}
      aria-hidden="true"
    >
      {flights.map((flight) => {
        const at = Math.round(startMs + flight.span * staggerMs);
        const left = Math.round(flight.x);
        const top = Math.round(flight.y);
        const style: CSSProperties = {
          left: `${left}px`,
          top: `${top}px`,
          ['--dx' as string]: `${Math.round(flight.dx)}px`,
          ['--dy' as string]: `${Math.round(flight.dy)}px`,
          ['--flight-at' as string]: `${at}ms`,
          ...(flight.lift === null
            ? {}
            : { ['--flight-lift' as string]: `calc(${-flight.lift} * var(--u))` }),
        };
        return (
          <Fragment key={flight.key}>
            {/* Absprung: ein Ring am Start, dann die Glanzpunkte unter dem Zeichen */}
            <span
              className="flight-ring"
              style={{ ...style, ['--ring-at' as string]: `${at}ms` }}
            />
            {Array.from({ length: trail }, (_, index) => (
              <span
                key={index}
                className="flight trail"
                style={{ ...style, ['--trail' as string]: index + 1 }}
              >
                <span className="flight-arc">
                  <i />
                </span>
              </span>
            ))}
            <span className="flight" style={style}>
              <span className="flight-arc">{flight.icon}</span>
            </span>
            {tone === 'coin' ? (
              // Die Scheibe kommt im Blatt mit einem Ring an; Plättchen fangen die Vorräte selbst
              <span
                className="flight-ring land"
                style={{
                  left: `${Math.round(flight.x + flight.dx)}px`,
                  top: `${Math.round(flight.y + flight.dy)}px`,
                  ['--ring-at' as string]: `${at + flightMs - 40}ms`,
                }}
              />
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}
