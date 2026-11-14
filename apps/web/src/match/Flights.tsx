import {
  useLayoutEffect,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';

/**
 * Zeichen, die einmal über die Bühne fliegen (ADR-067): Brot und Baustoff von den Feldern in den
 * Vorrat, die Kategorie vom Rad ins Blatt. Start und Ziel sind Elemente der Bühne; gemessen wird
 * einmal, wenn der Flug beginnt. Die Ebene nimmt keine Tipps an und verschiebt nichts. Ohne
 * Animation (laufende Frage, „Bewegung reduzieren“) bleibt sie unsichtbar: Das Endbild steht schon.
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
  return (
    <div
      className={`flight-layer tone-${tone}`}
      style={{ ['--flight-ms' as string]: `${flightMs}ms` }}
      aria-hidden="true"
    >
      {flights.map((flight) => {
        const style: CSSProperties = {
          left: `${Math.round(flight.x)}px`,
          top: `${Math.round(flight.y)}px`,
          ['--dx' as string]: `${Math.round(flight.dx)}px`,
          ['--dy' as string]: `${Math.round(flight.dy)}px`,
          ['--flight-at' as string]: `${Math.round(startMs + flight.span * staggerMs)}ms`,
        };
        return (
          <span key={flight.key} className="flight" style={style}>
            <span className="flight-arc">{flight.icon}</span>
          </span>
        );
      })}
    </div>
  );
}
