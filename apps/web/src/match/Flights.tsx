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
 * einmal, wenn der Flug beginnt. Jedes Zeichen springt mit einem kleinen Ring ab und zieht ein, zwei
 * goldene Glanzpunkte hinter sich her, die denselben Bogen etwas später fliegen (ADR-069). Die
 * Ebene nimmt keine Tipps an und verschiebt nichts. Ohne Animation (laufende Frage, „Bewegung
 * reduzieren“) bleibt sie unsichtbar: Das Endbild steht schon.
 */
export interface FlightPlan {
  readonly key: string;
  /** Start und Ziel als Selektoren innerhalb der Bühne. */
  readonly from: string;
  readonly to: string;
  /** Wo im Ziel der Flug endet: Mitte oder linker Rand (das Zeichen vor einer Zahl). */
  readonly at?: 'centre' | 'start';
  readonly icon: ReactNode;
  /** Rang im Abflug; gleiche Ränge fliegen zusammen. */
  readonly order?: number;
  /** Versatz des Starts nach rechts in Pixeln: Zwei Zeichen vom selben Feld liegen nebeneinander. */
  readonly shift?: number;
}

interface Flight {
  readonly key: string;
  readonly icon: ReactNode;
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;
  readonly span: number;
}

/** Ab so vielen Zeichen zieht jedes nur noch einen Glanzpunkt nach: Es soll ruhig bleiben. */
const BUSY = 10;

/** Glanzpunkte hinter einem Zeichen: die Scheibe vom Rad drei, Plättchen zwei, viele nur einen. */
export function flightTrail(tone: 'token' | 'coin', count: number): number {
  if (tone === 'coin') return 3;
  return count > BUSY ? 1 : 2;
}

function centre(box: DOMRect, at: 'centre' | 'start' = 'centre'): { x: number; y: number } {
  return {
    x: at === 'start' ? box.left + box.height / 2 : box.left + box.width / 2,
    y: box.top + box.height / 2,
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
      const to = element.querySelector(plan.to)?.getBoundingClientRect();
      if (!from || !to) return [];
      const a = centre(from);
      const b = centre(to, plan.at);
      return [
        {
          key: plan.key,
          icon: plan.icon,
          x: a.x - origin.left + (plan.shift ?? 0),
          y: a.y - origin.top,
          dx: b.x - a.x - (plan.shift ?? 0),
          dy: b.y - a.y,
          span: plan.order ?? 0,
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
