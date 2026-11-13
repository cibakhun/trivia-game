import { useEffect, useState } from 'react';

/**
 * Einkommen als Bewegung (ADR-067): Zu Beginn der Rüstzeit wandern Brot und Baustoff von den
 * eigenen Feldern in den eigenen Vorrat links, die Zahlen dort zählen hoch, wenn die ersten
 * Zeichen ankommen. Gezeigt wird nur ein Einkommen, das diese Seite hat kommen sehen.
 */
export interface IncomeTiming {
  /** Wartezeit vor dem ersten Abflug: Der Bildschirm der Rüstzeit steht dann. */
  readonly startMs: number;
  readonly flightMs: number;
  /** Abstand zwischen zwei Abflügen; bei vielen Feldern enger, damit es nicht länger dauert. */
  readonly staggerMs: number;
  /** Ab wann und wie lange die Vorräte hochzählen. */
  readonly countAtMs: number;
  readonly countMs: number;
  /** Danach ist alles vorbei, die Ebene wird abgeräumt. */
  readonly totalMs: number;
}

const START_MS = 250;
const FLIGHT_MS = 800;
const STAGGER_MS = 80;
/** So lange dürfen die Abflüge zusammen höchstens auseinanderliegen. */
const SPREAD_MS = 640;

export function incomeTiming(count: number): IncomeTiming {
  const gaps = Math.max(0, count - 1);
  const staggerMs = gaps === 0 ? 0 : Math.min(STAGGER_MS, SPREAD_MS / gaps);
  const spread = gaps * staggerMs;
  // Die Zahlen laufen mit den Ankünften mit: vom ersten Zeichen bis zum letzten
  const countAtMs = START_MS + FLIGHT_MS - 60;
  const countMs = Math.max(300, spread + 120);
  return {
    startMs: START_MS,
    flightMs: FLIGHT_MS,
    staggerMs,
    countAtMs,
    countMs,
    totalMs: Math.max(START_MS + spread + FLIGHT_MS, countAtMs + countMs) + 300,
  };
}

/**
 * Welches Einkommen gerade als Bewegung läuft: die Nummer seines Ereignisses, sonst `null`.
 * `ready`: Der Bildschirm der eigenen Rüstzeit steht (vorher wartet es); `live`: Die Seite hat
 * einen Wechsel miterlebt, sie wurde also nicht eben erst mit diesem Stand geladen.
 */
export function useIncomeFlight(
  incomeSeq: number,
  ready: boolean,
  live: boolean,
  totalMs: number,
): number | null {
  const [flight, setFlight] = useState<{ seen: number; playing: number | null }>(() => ({
    seen: incomeSeq,
    playing: null,
  }));
  // Merken während des Renderns: Die Vorräte zählen von Anfang an mit der Wartezeit
  if (ready && incomeSeq > flight.seen) {
    setFlight({ seen: incomeSeq, playing: live ? incomeSeq : null });
  }
  const playing = flight.playing;
  useEffect(() => {
    if (playing === null) return;
    const timer = setTimeout(
      () => setFlight((now) => (now.playing === playing ? { ...now, playing: null } : now)),
      totalMs,
    );
    return () => clearTimeout(timer);
  }, [playing, totalMs]);
  return ready ? playing : null;
}
