import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { sheetSwap, type SheetKind, type SheetSwap } from './sheet-swap.ts';

/** Spätestens dann ist ein Abbild fort, auch wenn der Browser das Ende der Bewegung nicht meldet. */
const GHOST_MS = 600;

/** Das Abbild darf nichts sein, was Tests, Vorleser oder Finger finden. */
function ghostOf(sheet: Element): HTMLElement {
  const copy = sheet.cloneNode(true) as HTMLElement;
  for (const node of [copy, ...copy.querySelectorAll<HTMLElement>('[data-testid], [id]')]) {
    node.removeAttribute('data-testid');
    node.removeAttribute('id');
  }
  return copy;
}

/**
 * Mitte der Bühne: das Blatt, das gerade gilt, und für einen Augenblick das Abbild dessen, das
 * eben ging (`sheetSwap`). React kennt nur das neue Blatt; das alte ist ein stilles Abbild seines
 * letzten Bildes ohne eigene Bewegung, das sich wegdreht oder abhebt und dann verschwindet. So
 * hängt an ihm kein Zustand, kein Zeitgeber und kein Tipp.
 *
 * Beim ersten Aufbau der Seite und ohne Bewegung (`prefers-reduced-motion`) gibt es kein Abbild.
 */
export function StageCentre({
  kind,
  className = '',
  children,
}: {
  /** Art des Blatts; `null`, wenn keines liegt. */
  readonly kind: SheetKind | null;
  /** Zusätze zur Klasse der Mitte (`wide`, `disc`). */
  readonly className?: string;
  readonly children: ReactNode;
}) {
  // Wie das Blatt kam, gilt, solange es liegt: Seine Animation behält so ihren Namen
  const [arrival, setArrival] = useState<{
    readonly kind: SheetKind | null;
    readonly by: SheetSwap | null;
  }>({ kind, by: null });
  if (arrival.kind !== kind) setArrival({ kind, by: sheetSwap(arrival.kind, kind) });
  const turned = arrival.kind === kind && arrival.by === 'turn';
  const classes = `${className ? ` ${className}` : ''}`;

  const host = useRef<HTMLDivElement>(null);
  const ghosts = useRef<HTMLDivElement>(null);
  const last = useRef<{
    readonly kind: SheetKind | null;
    readonly sheet: Element | null;
    readonly classes: string;
  }>({ kind, sheet: null, classes });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Nach jedem Zeichnen: Das Blatt merken, solange es im Dokument steht. Ist es beim nächsten Mal
  // fort, lebt sein Knoten noch und gibt das Abbild her
  useLayoutEffect(() => {
    const before = last.current;
    last.current = { kind, sheet: host.current?.firstElementChild ?? null, classes };
    const layer = ghosts.current;
    if (!layer || before.kind === kind) return;
    layer.replaceChildren();
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const leave = sheetSwap(before.kind, kind);
    if (!leave || !before.sheet) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const frame = document.createElement('div');
    frame.className = `sheet-ghost${before.classes} leave-${leave}`;
    frame.inert = true;
    const copy = ghostOf(before.sheet);
    frame.append(copy);
    layer.append(frame);
    const drop = () => frame.remove();
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
        <div ref={host} className={`stage-centre${classes}${turned ? ' turned' : ''}`}>
          {children}
        </div>
      ) : null}
    </>
  );
}
