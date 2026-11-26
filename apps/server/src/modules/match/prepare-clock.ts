import { realmRoundOrder, type RealmState } from '@rdw/game-core';
import { botPrepareMs } from './bot-think.ts';

/**
 * Uhr der Rüstzeit (ADR-085). Bots geben nicht mehr beim Öffnen ab, sondern jeder nach seiner
 * Bedenkzeit (`botPrepareMs`). Die Partie speichert nur eine Frist (`phase_deadline_at`); in der
 * Rüstzeit ist das der nächste Weckpunkt: der nächste Bot, der noch überlegt, sonst das Ende der
 * Rüstzeit. Weil die Bedenkzeiten nur von Partie, Runde und Sitz abhängen, lassen sich Beginn und
 * Ende der Rüstzeit aus dieser Frist zurückrechnen. Lauf (`RealmRun`) und Ansicht rechnen deshalb
 * mit denselben Funktionen, und ein Neustart des Servers verliert nichts.
 */

/** Ein Bot, der in der Rüstzeit noch überlegt, und wann er ab ihrem Beginn abgibt. */
export interface PendingBot {
  readonly seat: number;
  readonly delayMs: number;
}

/**
 * Bots, die in der Rüstzeit `round` noch nicht abgegeben haben, nach ihrer Bedenkzeit geordnet
 * (bei gleicher Zeit nach der Reihenfolge der Runde). Leer außerhalb dieser Rüstzeit.
 */
export function pendingBots(
  state: RealmState,
  round: number,
  matchId: string,
  prepareMs: number,
  isBot: (seat: number) => boolean,
): PendingBot[] {
  const { step } = state;
  if (step.kind !== 'PREPARE' || step.round !== round) return [];
  return realmRoundOrder(state, round)
    .filter((seat) => isBot(seat) && step.orders[seat] === null)
    .map((seat) => ({ seat, delayMs: botPrepareMs(matchId, round, seat, prepareMs) }))
    .sort((a, b) => a.delayMs - b.delayMs);
}

/** Nächster Weckpunkt ab Beginn der Rüstzeit: der nächste überlegende Bot oder das Ende der Frist. */
export function nextPrepareWakeMs(pending: readonly PendingBot[], totalMs: number): number {
  return Math.min(totalMs, ...pending.map((bot) => bot.delayMs));
}

/** Beginn der Rüstzeit, zurückgerechnet aus der gespeicherten Frist (dem nächsten Weckpunkt). */
export function prepareStartMs(
  deadlineMs: number,
  pending: readonly PendingBot[],
  totalMs: number,
): number {
  return deadlineMs - nextPrepareWakeMs(pending, totalMs);
}

/** Ende der Rüstzeit, wie es Menschen sehen: Beginn plus ganze Frist. */
export function prepareEndMs(
  deadlineMs: number,
  pending: readonly PendingBot[],
  totalMs: number,
): number {
  return prepareStartMs(deadlineMs, pending, totalMs) + totalMs;
}
