/**
 * Version der Spiellogik, die mit jedem Kampfergebnis gespeichert wird (`battle_results.core_version`).
 * Erhöhen, wenn sich Auswertung, NPC-Modell oder Fragenauswahl ändern, damit alte Ergebnisse
 * nachvollziehbar bleiben.
 */
export const CORE_VERSION = '1';

export * from './attack.ts';
export * from './capital.ts';
export * from './deadlines.ts';
export * from './decimal.ts';
export * from './drops.ts';
export * from './duel.ts';
export * from './hex.ts';
export * from './mapgen.ts';
export * from './match.ts';
export * from './match-bots.ts';
export * from './match-map.ts';
export * from './names.ts';
export * from './npc.ts';
export * from './question-pick.ts';
export * from './rank.ts';
export * from './rng.ts';
export * from './scoring.ts';
export * from './spawn.ts';
export * from './timing.ts';
