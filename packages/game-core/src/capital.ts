import { areNeighbors, type Axial } from './hex.ts';

/**
 * Hauptstadt-Leben (docs/GAME_RULES.md §3, PO-Entscheidung 2026-11-10, ADR-037): Jeder Sieg eines
 * Angreifers über eine Hauptstadt kostet ein Leben; der Sieg, der das letzte Leben nimmt,
 * übernimmt das ganze Reich. Solange kein neuer Treffer kommt, kehrt je `lifeRegen` ein Leben
 * zurück. Gespeichert werden nur die nicht erholten Treffer zum Zeitpunkt des letzten Treffers;
 * die aktuellen Leben ergeben sich daraus, aus den Regeln und der Uhrzeit.
 */

export interface CapitalRules {
  /** Leben einer unbeschädigten Hauptstadt (≥ 1). */
  readonly lives: number;
  /** Ohne neuen Treffer kehrt nach so vielen ms ein Leben zurück; `null` = nie. */
  readonly lifeRegen: number | null;
  /** Schutz der Hauptstadt nach einem Treffer, der sie nicht einnimmt (ms). */
  readonly protectionAfterHit: number;
}

export interface CapitalDamage {
  /** Nicht erholte Treffer zum Zeitpunkt des letzten Treffers. */
  readonly hits: number;
  /** Zeitpunkt des letzten Treffers (ms); `null` = nie getroffen. */
  readonly lastHitAt: number | null;
}

export interface CapitalLives {
  readonly lives: number;
  readonly maxLives: number;
  /** Wann das nächste Leben zurückkehrt (ms); `null` bei vollen Leben oder ohne Erholung. */
  readonly nextLifeAt: number | null;
}

function checkRules(rules: CapitalRules): void {
  if (!Number.isInteger(rules.lives) || rules.lives < 1) {
    throw new RangeError(`Hauptstadt-Leben müssen ≥ 1 sein: ${rules.lives}`);
  }
  if (rules.lifeRegen !== null && !(rules.lifeRegen > 0)) {
    throw new RangeError(`Erholungszeit muss positiv sein: ${rules.lifeRegen}`);
  }
}

/** Erholte Leben seit dem letzten Treffer. */
function recovered(damage: CapitalDamage, rules: CapitalRules, now: number): number {
  if (rules.lifeRegen === null || damage.lastHitAt === null) return 0;
  return Math.floor(Math.max(0, now - damage.lastHitAt) / rules.lifeRegen);
}

/** Aktuell fehlende Leben, höchstens alle (auch wenn die Regeln inzwischen weniger Leben geben). */
function missingLives(damage: CapitalDamage, rules: CapitalRules, now: number): number {
  if (damage.hits <= 0) return 0;
  return Math.min(rules.lives, Math.max(0, damage.hits - recovered(damage, rules, now)));
}

export function capitalLives(
  damage: CapitalDamage,
  rules: CapitalRules,
  now: number,
): CapitalLives {
  checkRules(rules);
  const missing = missingLives(damage, rules, now);
  const nextLifeAt =
    missing > 0 && rules.lifeRegen !== null && damage.lastHitAt !== null
      ? damage.lastHitAt + (recovered(damage, rules, now) + 1) * rules.lifeRegen
      : null;
  return { lives: rules.lives - missing, maxLives: rules.lives, nextLifeAt };
}

export type CapitalHit =
  /** Die Hauptstadt verliert ein Leben und bleibt beim Reich; neuer gespeicherter Stand. */
  | { readonly kind: 'HIT'; readonly damage: CapitalDamage; readonly livesLeft: number }
  /** Das letzte Leben ist verloren: Das Reich geht an den Angreifer. */
  | { readonly kind: 'TAKEOVER' };

/**
 * Wirkung eines Angreifersiegs über die Hauptstadt zum Zeitpunkt `now`. Erholte Leben werden
 * vorher angerechnet; der Erholungstakt beginnt mit dem Treffer neu.
 */
export function hitCapital(damage: CapitalDamage, rules: CapitalRules, now: number): CapitalHit {
  checkRules(rules);
  const hits = missingLives(damage, rules, now) + 1;
  if (hits >= rules.lives) return { kind: 'TAKEOVER' };
  return { kind: 'HIT', damage: { hits, lastHitAt: now }, livesLeft: rules.lives - hits };
}

/** Grenzt `target` an mindestens eine der Regionen? (GAME_RULES §4.4) */
export function isAdjacentToAny(target: Axial, regions: readonly Axial[]): boolean {
  return regions.some((region) => areNeighbors(region, target));
}
