import { useEffect, useState } from 'react';

/**
 * Einkommen als Bewegung (ADR-067): Zu Beginn der Rüstzeit wandern Brot und Baustoff von den
 * eigenen Feldern in den eigenen Vorrat links, die Zahlen dort zählen hoch, wenn die ersten
 * Zeichen ankommen. Gezeigt wird nur ein Einkommen, das diese Seite hat kommen sehen. Verbucht ist
 * es beim Server schon vorher, mit dem Ende der Runde davor: Solange die Rüstzeit nicht begonnen
 * hat, zeigen die Vorräte aller Reiche noch den Stand davor.
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
  /** Bis dahin sind alle Zeichen angekommen. */
  readonly landedMs: number;
  /** Danach ist alles vorbei, auch das Nachfedern im Vorrat; die Ebene wird abgeräumt. */
  readonly totalMs: number;
}

const START_MS = 250;
const FLIGHT_MS = 800;
const STAGGER_MS = 80;
/** So lange dürfen die Abflüge zusammen höchstens auseinanderliegen. */
const SPREAD_MS = 640;
/**
 * So lange federt der Vorrat nach dem letzten Zeichen nach (Ring und Verlöschen in `realm.css`):
 * Erst danach darf die Ebene weg, sonst bräche die Bewegung mitten ab.
 */
const SETTLE_MS = 780;

export function incomeTiming(count: number): IncomeTiming {
  const gaps = Math.max(0, count - 1);
  const staggerMs = gaps === 0 ? 0 : Math.min(STAGGER_MS, SPREAD_MS / gaps);
  const spread = gaps * staggerMs;
  // Die Zahlen laufen mit den Ankünften mit: vom ersten Zeichen bis zum letzten
  const countAtMs = START_MS + FLIGHT_MS - 60;
  const countMs = Math.max(300, spread + 120);
  const landedMs = START_MS + spread + FLIGHT_MS;
  return {
    startMs: START_MS,
    flightMs: FLIGHT_MS,
    staggerMs,
    countAtMs,
    countMs,
    landedMs,
    totalMs: Math.max(landedMs, countAtMs + countMs + SETTLE_MS) + 80,
  };
}

/** Was diese Seite von den Einkommen der Partie schon gezeigt hat. */
export interface IncomeWatch {
  /** Nummer des letzten Einkommens, das gezeigt oder übergangen ist. */
  readonly seen: number;
  /** Nummer des Einkommens, das gerade fliegt. */
  readonly playing: number | null;
  /**
   * Nummer des Einkommens, dessen Zahlen gerade sichtbar hochzählen, weil die Seite seine Freigabe
   * miterlebt hat: mit eigenem Flug oder ohne (Zuschauer, gefallenes Reich). Die Tafeln der anderen
   * schimmern dann (ADR-068).
   */
  readonly rising: number | null;
}

/**
 * Wie es mit dem jüngsten Einkommen (`incomeSeq`) weitergeht. Der Server verbucht es schon mit dem
 * Ende des letzten Duells der Runde, die Rüstzeit beginnt erst nach dessen Auflösung: Bis dahin
 * bleibt der Stand unverändert, und die Vorräte zeigen noch den Wert davor (`incomeHeld`).
 * `ready`: Der Bildschirm der eigenen Rüstzeit steht, jetzt fliegt es. `moved`: Die Partie ist
 * weiter, ohne dass die eigene Rüstzeit stand (Zuschauer, gefallenes Reich, nur noch Bots, Ende):
 * Das Einkommen gilt als gezeigt. `live`: Die Seite hat einen Wechsel miterlebt.
 */
export function incomeWatch(
  now: IncomeWatch,
  incomeSeq: number,
  ready: boolean,
  moved: boolean,
  live: boolean,
): IncomeWatch {
  if (incomeSeq <= now.seen) return now;
  const rising = live ? incomeSeq : null;
  if (ready) return { seen: incomeSeq, playing: rising, rising };
  if (moved) return { seen: incomeSeq, playing: null, rising };
  return now;
}

/** Das jüngste Einkommen ist verbucht, aber noch nicht gezeigt: Die Vorräte warten darauf. */
export function incomeHeld(now: IncomeWatch, incomeSeq: number): boolean {
  return incomeSeq > now.seen;
}

export interface IncomeFlight {
  /** Nummer des Einkommens, das gerade als Bewegung läuft, sonst `null`. */
  readonly playing: number | null;
  /** Die Vorräte zeigen noch den Stand vor dem jüngsten Einkommen. */
  readonly held: boolean;
  /** Nummer des Einkommens, dessen Zahlen gerade sichtbar hochzählen, sonst `null`. */
  readonly rising: number | null;
}

/**
 * Welches Einkommen gerade als Bewegung läuft und ob die Vorräte noch darauf warten; `ready`,
 * `moved` und `live` wie bei `incomeWatch`.
 */
export function useIncomeFlight(
  incomeSeq: number,
  ready: boolean,
  moved: boolean,
  live: boolean,
  totalMs: number,
): IncomeFlight {
  const [flight, setFlight] = useState<IncomeWatch>(() => ({
    seen: incomeSeq,
    playing: null,
    rising: null,
  }));
  // Merken während des Renderns: Die Vorräte zählen von Anfang an mit der Wartezeit
  const next = incomeWatch(flight, incomeSeq, ready, moved, live);
  if (next !== flight) setFlight(next);
  // Flug und Schimmer beginnen zusammen und sind nach derselben Zeit vorbei
  const rising = flight.rising;
  useEffect(() => {
    if (rising === null) return;
    const timer = setTimeout(
      () =>
        setFlight((now) => (now.rising === rising ? { ...now, playing: null, rising: null } : now)),
      totalMs,
    );
    return () => clearTimeout(timer);
  }, [rising, totalMs]);
  return {
    playing: ready ? next.playing : null,
    held: incomeHeld(next, incomeSeq),
    rising: next.rising,
  };
}
