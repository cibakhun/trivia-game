import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { outcomeBeatMs, type MatchScreenState } from './match-model.ts';

/**
 * Takt der Bühne für Wechsel am Rand (docs/ART_DIRECTION.md §5): Spielstand links, Blatt rechts.
 * Hier steht, wann ein Wechsel als miterlebt gilt, wann das Blatt eine neue Seite aufschlägt und
 * wann der Spielstand dem Schlag eines Duells folgt. Reine Ableitungen und kleine Haken dazu; was
 * sich dann bewegt, steht in `stage.css`.
 */

/** Hat die Bühne schon einen Wechsel miterlebt? Beim ersten Aufbau läuft keine Änderungsanimation. */
export const StageLive = createContext(false);

/**
 * `true`, sobald die Bühne einen Wechsel ihres Zustands miterlebt hat. Das Laden zählt nicht: Wer
 * mitten im Spiel lädt, sieht das erste Bild ohne Bewegung (Merken während des Renderns).
 */
export function useLive(state: MatchScreenState): boolean {
  const [entered, setEntered] = useState<{
    readonly first: MatchScreenState | null;
    readonly live: boolean;
  }>({ first: state === 'loading' ? null : state, live: false });
  if (entered.first === null) {
    if (state !== 'loading') setEntered({ first: state, live: false });
    return false;
  }
  if (!entered.live && state !== entered.first) setEntered({ first: entered.first, live: true });
  return entered.live || state !== entered.first;
}

/**
 * `true`, wenn dieses Element bei einem miterlebten Wechsel erschien. Beim Erscheinen festgelegt:
 * Ein späteres Rendern hängt die Bewegung nicht nachträglich an (wie `Born` in `MatchBoard.tsx`).
 */
export function useBorn(): boolean {
  const live = useContext(StageLive);
  const [born] = useState(live);
  return born;
}

/** Woran das Blatt rechts erkennt, dass es eine neue Seite aufschlägt. */
export interface BlattSceneStep {
  readonly kind: string;
  readonly round: number | null;
  readonly chooser: number | null;
  readonly attacker: number | null;
  readonly region: number | null;
}

/**
 * Seite des Blatts rechts: Wechselt dieser Schlüssel, schlägt das Blatt um, und sein Inhalt
 * schreibt sich neu ein. Bleibt er gleich, ändert sich nur etwas auf derselben Seite, und das
 * Blatt bleibt ruhig: die nächste Wahl derselben Art in der Ansage, die eigene Antwort auf eine
 * laufende Frage, „Fertig“ und „Befehle ändern“ in der Rüstzeit, ein angetipptes Ziel.
 *
 * `shown` ist die Art der Wahl, die eine Ansage gerade zeigt (`shownPick`), `outcome`, ob das
 * Blatt schon den Ausgang eines Duells nennt (ADR-069).
 */
export function blattScene(
  state: MatchScreenState,
  step: BlattSceneStep | null,
  seq: number | null,
  outcome = false,
  shown: string | null = null,
): string {
  switch (state) {
    case 'pick':
      return `pick:${step?.kind}:${step?.round}`;
    case 'waiting-pick':
      return `wait:${step?.kind}:${step?.chooser}`;
    case 'announce':
      return `announce:${shown ?? `${step?.kind}:${step?.attacker}:${step?.region}`}`;
    case 'wheel':
      return `wheel:${step?.round}:${step?.attacker}:${step?.region}`;
    case 'question':
    case 'presenting':
    case 'answered':
    case 'missed':
    case 'spectating':
      return `question:${seq}`;
    case 'reveal':
      return `${outcome ? 'outcome' : 'reveal'}:${seq}`;
    case 'prepare':
    case 'prepared':
      return `prepare:${step?.round}`;
    case 'watching-prepare':
      return `prepare-watch:${step?.round}`;
    case 'orders':
    case 'finished':
    case 'loading':
    case 'lobby':
    case 'abandoned':
      return state;
  }
}

/** Umschlagen des Blatts: zwei Namen im Wechsel, damit jede neue Seite die Bewegung neu anstößt. */
export type BlattTurn = 'a' | 'b';

/**
 * Meldet, dass das Blatt eben umgeschlagen hat (`turn`), bis die Bewegung dazu vorbei ist
 * (`settle`, vom Ende der CSS-Animation gerufen). Danach trägt die Bühne die Klasse nicht mehr:
 * Was später auf derselben Seite erscheint, läuft nicht mit ein. Nur für miterlebte Wechsel.
 */
export function useBlattTurn(
  scene: string,
  live: boolean,
): { readonly turn: BlattTurn | null; readonly settle: () => void } {
  const [seen, setSeen] = useState<{
    readonly scene: string;
    readonly count: number;
    readonly open: boolean;
  }>({ scene, count: 0, open: false });
  let now = seen;
  if (seen.scene !== scene) {
    now = { scene, count: seen.count + (live ? 1 : 0), open: live };
    setSeen(now);
  }
  const settle = useCallback(
    () => setSeen((current) => (current.open ? { ...current, open: false } : current)),
    [],
  );
  return { turn: now.open ? (now.count % 2 === 1 ? 'a' : 'b') : null, settle };
}

/** Der Schlag eines Duells sitzt 0,41 s nach Beginn des Ausgangs (Einschlag 0,35 s, Treffer-Stopp). */
export const IMPACT_MS = 410;

/**
 * So lange bleibt der Spielstand im Takt des Ausgangs noch beim Stand davor: bis der Schlag sitzt,
 * höchstens aber die halbe Dauer des Takts (mit Spieltestzeiten ist er nur eine halbe Sekunde lang).
 */
export function impactHoldMs(revealMs: number): number {
  return Math.min(IMPACT_MS, Math.round(outcomeBeatMs(revealMs) / 2));
}

/**
 * Was der Spielstand links zeigt, während die Karte den Ausgang eines Duells spielt (ADR-069):
 * Leben, Punkte, Zugfolge und ein gefallenes Reich folgen dem Schlag, statt ihn vorwegzunehmen.
 * Solange `key` gesetzt ist (Kennung des laufenden Ausgangs) und der Schlag noch nicht sitzt,
 * bleibt der letzte Stand von davor stehen; danach und außerhalb gilt `value`. Wer den Stand davor
 * nicht gesehen hat (`key` schon beim ersten Bild gesetzt), sieht gleich den neuen. Mit
 * `holdMs = Infinity` bleibt der Stand davor, solange `key` gesetzt ist: So zeigen Band und Ablauf
 * oben links die Runde des Duells, bis seine Auflösung vorbei ist, und nicht schon die nächste.
 * Mit „Bewegung reduzieren“ wartet der Stand nicht auf den Schlag: Die Karte zeigt ihn dann nicht.
 */
export function useAfterImpact<T>(value: T, key: number | null, holdMs: number): T {
  const before = useRef<{ readonly value: T } | null>(null);
  const [struck, setStruck] = useState<number | null>(null);
  // Ohne Bewegung gibt es keinen Schlag, auf den der Stand warten könnte
  const wait = Number.isFinite(holdMs) && motionReduced() ? 0 : holdMs;
  useEffect(() => {
    if (key === null) before.current = { value };
  });
  useEffect(() => {
    if (key === null || wait <= 0 || !Number.isFinite(wait)) return;
    const timer = setTimeout(() => setStruck(key), wait);
    return () => clearTimeout(timer);
  }, [key, wait]);
  const held = key !== null && wait > 0 && struck !== key ? before.current : null;
  return held ? held.value : value;
}

/** „Bewegung reduzieren“ ist eingeschaltet (im Test ohne Fenster: nein). */
function motionReduced(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
