import {
  QUESTION_CATEGORIES,
  type MeResponse,
  type PlayerStatsResponse,
  type QuestionCategory,
} from '@rdw/protocol';
import { formatNumber, t } from '../i18n/i18n.ts';

/**
 * Texte und Rechnungen der Kontoseite (ADR-080): Ansichten und Reiter, Wappenstufe, Wissen je
 * Kategorie, Zeitangaben. Reine Funktionen, damit Tests sie ohne Bühne prüfen.
 */

/** Ansichten mit eigenem Pfad (router.ts): „Zurück“ im Browser schließt sie wie ein Blatt. */
export const ACCOUNT_VIEWS = ['name', 'secure', 'password', 'login', 'logout'] as const;
export type AccountView = (typeof ACCOUNT_VIEWS)[number];

/** Reiter der rechten Seite; sie wechseln ohne Pfad, damit „Zurück“ nicht durch sie blättert. */
export const ACCOUNT_TABS = ['record', 'knowledge', 'access'] as const;
export type AccountTab = (typeof ACCOUNT_TABS)[number];

/** Welche Ansicht es für dieses Konto gibt; Gäste wählen ihren Namen beim Sichern. */
export function viewAllowed(view: AccountView, isGuest: boolean): boolean {
  switch (view) {
    case 'name':
    case 'password':
      return !isGuest;
    case 'secure':
    case 'login':
    case 'logout':
      return isGuest;
  }
}

/** Reiter, auf dem eine Ansicht liegt: Nach dem Schließen steht man wieder dort. */
export function tabOf(view: AccountView | null): AccountTab | null {
  if (view === null || view === 'name') return null;
  return 'access';
}

// ---------- Wappenstufe ----------

/**
 * Wappenstufen nach eigenen Siegen [E]: Das Wappen auf Plakette und Kontoseite wechselt sein
 * Metall. Rein zur Zierde, ohne Wirkung im Spiel; es zählen alle Siege wie in der Bilanz.
 */
export const CREST_TIERS = [
  { tier: 'wood', wins: 0 },
  { tier: 'bronze', wins: 1 },
  { tier: 'silver', wins: 5 },
  { tier: 'gold', wins: 15 },
  { tier: 'crown', wins: 40 },
] as const;
export type CrestTier = (typeof CREST_TIERS)[number]['tier'];

export interface CrestProgress {
  readonly tier: CrestTier;
  /** Nächste Stufe; `null` auf der höchsten. */
  readonly next: CrestTier | null;
  /** Siege bis zur nächsten Stufe; 0 auf der höchsten. */
  readonly toNext: number;
  /** Anteil des Wegs von dieser zur nächsten Stufe, 0 bis 1 (1 auf der höchsten). */
  readonly progress: number;
}

export function crestProgress(wins: number): CrestProgress {
  const won = Math.max(0, Math.floor(wins));
  let index = 0;
  for (let i = 0; i < CREST_TIERS.length; i++) {
    if (won >= CREST_TIERS[i]!.wins) index = i;
  }
  const here = CREST_TIERS[index]!;
  const next = CREST_TIERS[index + 1];
  if (!next) return { tier: here.tier, next: null, toNext: 0, progress: 1 };
  return {
    tier: here.tier,
    next: next.tier,
    toNext: next.wins - won,
    progress: (won - here.wins) / (next.wins - here.wins),
  };
}

// ---------- Kopf der Wappenseite ----------

const longDate = new Intl.DateTimeFormat('de-DE', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** „dabei seit 10. November 2026“. */
export function sinceText(iso: string): string {
  return t('konto.since', { date: longDate.format(new Date(iso)) });
}

/** Zeile unter dem Namen: gesichert mit Anmeldename oder Gast. */
export function statusLine(me: MeResponse): string {
  return me.user.isGuest
    ? t('konto.status.guest')
    : t('konto.status.secured', { username: me.user.username ?? '' });
}

// ---------- Bilanz ----------

/** Anteil in Prozent, gerundet; `null` ohne Grundmenge. */
export function percentOf(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((Math.min(part, whole) / whole) * 100);
}

/** „62 %“ oder „–“. */
export function percentText(value: number | null): string {
  return value === null ? '–' : `${formatNumber(value)}\u00a0%`;
}

/** Sekunden mit einer Nachkommastelle: „1,8 s“. */
export function secondsText(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  return `${seconds.toLocaleString('de-DE', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}\u00a0s`;
}

/** „24 von 40“. */
export function ofText(part: number, whole: number): string {
  return t('konto.of', { part: formatNumber(part), whole: formatNumber(whole) });
}

// ---------- Wissen ----------

export interface KnowledgeRow {
  readonly category: QuestionCategory;
  readonly answered: number;
  readonly correct: number;
  /** Trefferquote in Prozent; `null` ohne gewertete Antwort. */
  readonly rate: number | null;
}

/**
 * Alle elf Kategorien für die Wissensseite: zuerst die gespielten, nach Trefferquote (bei
 * Gleichstand mehr Antworten zuerst), dann die ungespielten in fester Reihenfolge.
 */
export function knowledgeRows(stats: PlayerStatsResponse['trivia']): KnowledgeRow[] {
  const byCategory = new Map(stats.categories.map((c) => [c.category, c]));
  const rows = QUESTION_CATEGORIES.map((category) => {
    const entry = byCategory.get(category);
    const answered = entry?.answered ?? 0;
    const correct = entry?.correct ?? 0;
    return { category, answered, correct, rate: percentOf(correct, answered) };
  });
  return rows.sort((a, b) => {
    if (a.rate === null || b.rate === null) {
      if (a.rate === b.rate) {
        return QUESTION_CATEGORIES.indexOf(a.category) - QUESTION_CATEGORIES.indexOf(b.category);
      }
      return a.rate === null ? 1 : -1;
    }
    return b.rate - a.rate || b.answered - a.answered;
  });
}

/** Ab so vielen Antworten nennt die Seite ein Gebiet stärkstes oder schwächstes [E]. */
export const KNOWLEDGE_MIN_ANSWERS = 3;

/** Stärkstes und schwächstes Gebiet mit genug Antworten; gleich, wenn nur eines reicht. */
export function knowledgeExtremes(
  rows: readonly KnowledgeRow[],
): { best: KnowledgeRow; worst: KnowledgeRow } | null {
  const counted = rows.filter((r) => r.answered >= KNOWLEDGE_MIN_ANSWERS && r.rate !== null);
  const best = counted[0];
  const worst = counted[counted.length - 1];
  return best && worst ? { best, worst } : null;
}
