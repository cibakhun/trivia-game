import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { sheetSwap, type SheetFace, type SheetKind, type SheetSwap } from './sheet-swap.ts';

/** Spätestens dann ist ein Abbild fort, auch wenn der Browser das Ende der Bewegung nicht meldet. */
const GHOST_MS = 600;

/** So lange liegt das neue Blatt über dem alten, bevor es, falls nötig, an seinen Platz rückt. */
const STAY_MS = 200;

/** Das Abbild darf nichts sein, was Tests, Vorleser oder Finger finden. */
export function ghostOf(sheet: Element): HTMLElement {
  const copy = sheet.cloneNode(true) as HTMLElement;
  for (const node of [copy, ...copy.querySelectorAll<HTMLElement>('[data-testid], [id]')]) {
    node.removeAttribute('data-testid');
    node.removeAttribute('id');
  }
  return copy;
}

/**
 * Legt das neue Blatt so, dass das, was liegen bleibt (`data-anchor`, die Antwortfelder), genau
 * dort steht, wo es auf dem alten stand. Was das neue Blatt mehr hat, wächst darunter an. Passt es
 * so nicht in die Mitte, rückt es, sobald es das alte verdeckt, sacht so weit wie nötig; ohne
 * Bewegung steht es gleich dort. Musste es oben enger rücken (`data-fit="tight"`), ist es dort
 * anders gebaut: Dann bleibt es in der Mitte.
 */
function layOver(sheet: HTMLElement, old: Element, area: Element, still: boolean): void {
  if (sheet.dataset.fit === 'tight') return;
  const was = old.querySelector('[data-anchor]')?.getBoundingClientRect();
  const is = sheet.querySelector('[data-anchor]')?.getBoundingClientRect();
  if (!was || !is || (was.height === 0 && was.width === 0)) return;
  const want = was.top - is.top;
  const box = sheet.getBoundingClientRect();
  const room = area.getBoundingClientRect();
  const [low, high] = [room.top - box.top, room.bottom - box.bottom];
  const shift = low > high ? 0 : Math.min(high, Math.max(low, want));
  if (Math.abs(shift) >= 0.5) sheet.style.setProperty('translate', `0 ${shift.toFixed(1)}px`);
  const rest = want - shift;
  if (still || Math.abs(rest) < 0.5 || typeof sheet.animate !== 'function') return;
  sheet.animate([{ transform: `translateY(${rest.toFixed(1)}px)` }, { transform: 'none' }], {
    duration: 300,
    delay: STAY_MS,
    easing: 'cubic-bezier(0.3, 0.7, 0.3, 1)',
    fill: 'backwards',
  });
}

/**
 * Mitte der Bühne: das Blatt, das gerade gilt, und für einen Augenblick das Abbild dessen, das
 * eben ging (`sheetSwap`). React kennt nur das neue Blatt; das alte ist ein stilles Abbild seines
 * letzten Bildes ohne eigene Bewegung, das unter dem neuen vergeht, sich wegdreht oder abhebt und
 * dann verschwindet. So hängt an ihm kein Zustand, kein Zeitgeber und kein Tipp.
 *
 * Beim ersten Aufbau der Seite gibt es kein Abbild. Ohne Bewegung (`prefers-reduced-motion`)
 * auch nicht: Dann wechseln die Blätter hart, eine Auflösung, die liegen bleibt, aber an der
 * Stelle der Frage.
 */
export function StageCentre({
  kind,
  face = null,
  className = '',
  children,
}: {
  /** Art des Blatts; `null`, wenn keines liegt. */
  readonly kind: SheetKind | null;
  /** Art der Frage auf einer Fragekarte oder Auflösung. */
  readonly face?: SheetFace | null;
  /** Zusätze zur Klasse der Mitte (`wide`, `disc`). */
  readonly className?: string;
  readonly children: ReactNode;
}) {
  // Wie das Blatt kam, gilt, solange es liegt: Seine Animation behält so ihren Namen
  const [arrival, setArrival] = useState<{
    readonly kind: SheetKind | null;
    readonly face: SheetFace | null;
    readonly by: SheetSwap | null;
  }>({ kind, face, by: null });
  if (arrival.kind !== kind || arrival.face !== face) {
    setArrival({ kind, face, by: sheetSwap(arrival, { kind, face }) });
  }
  const by = arrival.kind === kind && arrival.face === face ? arrival.by : null;
  const classes = `${className ? ` ${className}` : ''}`;
  const came = by === 'turn' ? ' turned' : by === 'stay' ? ' stayed' : '';

  const host = useRef<HTMLDivElement>(null);
  const ghosts = useRef<HTMLDivElement>(null);
  const last = useRef<{
    readonly kind: SheetKind | null;
    readonly face: SheetFace | null;
    readonly sheet: Element | null;
    readonly classes: string;
  }>({ kind, face, sheet: null, classes });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Nach jedem Zeichnen: Das Blatt merken, solange es im Dokument steht. Ist es beim nächsten Mal
  // fort, lebt sein Knoten noch und gibt das Abbild her
  useLayoutEffect(() => {
    const before = last.current;
    const sheet = host.current?.firstElementChild ?? null;
    last.current = { kind, face, sheet, classes };
    const layer = ghosts.current;
    if (!layer || (before.kind === kind && before.face === face)) return;
    layer.replaceChildren();
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const leave = sheetSwap(before, { kind, face });
    if (!leave || !before.sheet) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still && leave !== 'stay') return;
    const frame = document.createElement('div');
    // Ohne Bewegung ist das Abbild nur ein Messpunkt (`probe`) und steht keinen Augenblick da
    frame.className = `sheet-ghost${before.classes} ${still ? 'probe' : `leave-${leave}`}`;
    frame.inert = true;
    const copy = ghostOf(before.sheet);
    frame.append(copy);
    layer.append(frame);
    // Das Abbild steht, wo das alte Blatt stand: Daran richtet sich das neue aus
    if (leave === 'stay' && host.current && sheet instanceof HTMLElement) {
      layOver(sheet, copy, host.current, still);
    }
    const drop = () => frame.remove();
    if (still) {
      drop();
      return;
    }
    copy.addEventListener('animationend', (event) => {
      if (event.target === copy) drop();
    });
    timer.current = setTimeout(drop, GHOST_MS);
  });
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <>
      <div ref={ghosts} className="sheet-ghosts" aria-hidden="true" />
      {children ? (
        <div ref={host} className={`stage-centre${classes}${came}`}>
          {children}
        </div>
      ) : null}
    </>
  );
}
