import type { MatchListResponse, MatchRecord, MeResponse } from '@rdw/protocol';
import { formatNumber, t, tp } from '../i18n/i18n.ts';

/**
 * Texte des Hauptmenüs (ADR-074): Name auf der Plakette, Bilanz, die offene Partie und die Zeilen
 * der Chronik. Reine Funktionen, damit Tests sie ohne Bühne prüfen.
 */

export type MatchSummary = MatchListResponse['matches'][number];

/** Blätter des Hauptmenüs; jedes hat seinen Pfad (router.ts). */
export const MENU_SHEETS = ['new', 'join', 'practice', 'chronicle', 'account'] as const;
export type MenuSheet = (typeof MENU_SHEETS)[number];

export function isOpenMatch(match: MatchSummary): boolean {
  return match.status === 'LOBBY' || match.status === 'RUNNING';
}

/** Name auf der Plakette: Spielername, sonst Anmeldename; Gäste heißen „Gast“. */
export function playerName(me: MeResponse): string {
  return me.profile.displayName ?? me.user.username ?? t('menu.plate.guest');
}

/** Anfangsbuchstabe im Wappen der Plakette. */
export function initialOf(name: string): string {
  return Array.from(name.trim())[0]?.toLocaleUpperCase('de-DE') ?? '?';
}

/** Anteil richtiger Antworten in Prozent, gerundet; `null` ohne gewertete Antwort. */
export function hitRate(record: Pick<MatchRecord, 'answered' | 'correct'>): number | null {
  if (record.answered <= 0) return null;
  return Math.round((Math.min(record.correct, record.answered) / record.answered) * 100);
}

/** Bilanz unter dem Namen: „12 Partien · 5 Siege“. */
export function recordLine(record: MatchRecord): string {
  return `${tp('menu.plate.played', record.played)} · ${tp('menu.plate.won', record.won)}`;
}

const DAY = 24 * 60 * 60 * 1000;
const clock = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const date = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
});

function dayStart(at: Date): number {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
}

/** Zeitpunkt in der Chronik: „heute, 16:40“, „gestern, 21:05“, sonst mit Datum. */
export function whenText(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const days = Math.round((dayStart(now) - dayStart(at)) / DAY);
  const time = clock.format(at);
  if (days === 0) return t('menu.when.today', { time });
  if (days === 1) return t('menu.when.yesterday', { time });
  return t('menu.when.date', { date: date.format(at), time });
}

/** Spielart als Wort: „Klassisch“ oder „Mit Ausbau“; Übungspartien sagen es dazu. */
export function modeText(match: Pick<MatchSummary, 'mode' | 'kind'>): string {
  const mode = t(match.mode === 'REALM' ? 'realm.hub.REALM' : 'realm.hub.CLASSIC');
  return match.kind === 'TEST' ? t('menu.practiceOf', { mode }) : mode;
}

/** Gegner einer Partie: „gegen Márton und Bot (schwer)“; ohne Gegner leer. */
export function opponentsText(match: Pick<MatchSummary, 'opponents'>): string {
  const names = match.opponents.map((o) => o.name ?? t('menu.chronicle.someGuest'));
  if (names.length === 0) return '';
  if (names.length === 1) return t('menu.chronicle.against', { names: names[0] ?? '' });
  return t('menu.chronicle.against', {
    names: t('menu.chronicle.and', { a: names[0] ?? '', b: names[1] ?? '' }),
  });
}

/** Ergebnis einer beendeten Partie als Abzeichen: „Sieg“, „2.“, „3.“ oder „abgebrochen“. */
export function placeText(match: Pick<MatchSummary, 'status' | 'place'>): string {
  if (match.status === 'ABANDONED') return t('menu.chronicle.abandoned');
  if (match.place === 1) return t('menu.chronicle.win');
  if (match.place === null) return '–';
  return t('menu.chronicle.place', { place: match.place });
}

/** Eigene Wissensfragen einer Partie: „9 von 12 richtig“; ohne gewertete Antwort leer. */
export function answersText(match: Pick<MatchSummary, 'answered' | 'correct'>): string {
  if (match.answered <= 0) return '';
  return t('menu.chronicle.answers', {
    correct: formatNumber(match.correct),
    answered: formatNumber(match.answered),
  });
}

/** Zweite Zeile eines Eintrags: Gegner und richtige Antworten, mit Punkt getrennt. */
export function chronicleDetail(match: MatchSummary): string {
  return [opponentsText(match), answersText(match)].filter(Boolean).join(' · ');
}

/**
 * Zeile zur offenen Partie: „Mit Ausbau · seit heute, 16:40 · 3 Spieler“. Übungspartien nennen
 * keine Spielerzahl, denn die Bots zählen dort nicht mit.
 */
export function openLine(match: MatchSummary, now: Date = new Date()): string {
  return [
    modeText(match),
    t('menu.open.since', { when: whenText(match.createdAt, now) }),
    match.kind === 'TEST' ? '' : tp('menu.open.players', match.players),
  ]
    .filter(Boolean)
    .join(' · ');
}
