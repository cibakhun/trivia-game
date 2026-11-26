import {
  QUESTION_CATEGORIES,
  type EmailState,
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
export const ACCOUNT_VIEWS = [
  'name',
  'secure',
  'password',
  'login',
  'logout',
  'email',
  'delete',
] as const;
export type AccountView = (typeof ACCOUNT_VIEWS)[number];

/** Reiter der rechten Seite; sie wechseln ohne Pfad, damit „Zurück“ nicht durch sie blättert. */
export const ACCOUNT_TABS = ['record', 'knowledge', 'access'] as const;
export type AccountTab = (typeof ACCOUNT_TABS)[number];

/**
 * Welche Ansicht es für dieses Konto gibt; Gäste wählen ihren Namen beim Registrieren und haben
 * keine E-Mail-Adresse. Löschen können alle (O-47).
 */
export function viewAllowed(view: AccountView, isGuest: boolean): boolean {
  switch (view) {
    case 'name':
    case 'password':
    case 'email':
      return !isGuest;
    case 'secure':
    case 'login':
    case 'logout':
      return isGuest;
    case 'delete':
      return true;
  }
}

/** Reiter, auf dem eine Ansicht liegt: Nach dem Schließen steht man wieder dort. */
export function tabOf(view: AccountView | null): AccountTab | null {
  if (view === null || view === 'name') return null;
  return 'access';
}

// ---------- E-Mail und gesperrter Name (ADR-086) ----------

const dayMonth = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long' });

/** „26. Dezember“; mit `year` „26. Dezember 2026“. */
export function dateText(iso: string, year = false): string {
  return (year ? longDate : dayMonth).format(new Date(iso));
}

/**
 * Was das Konto jetzt tun sollte, für Plakette und Kontoseite: einen neuen Namen wählen (gesperrt)
 * oder die E-Mail-Adresse eintragen bzw. bestätigen, solange eine Frist läuft. Ohne Frist (der
 * Server verschickt keine Mails) drängt nichts.
 */
export type AccountAlert =
  | { readonly kind: 'name' }
  | { readonly kind: 'emailMissing'; readonly dueAt: string }
  | { readonly kind: 'emailUnverified'; readonly dueAt: string };

export function accountAlert(me: MeResponse): AccountAlert | null {
  if (me.user.isGuest) return null;
  if (me.profile.nameBlocked) return { kind: 'name' };
  const email = me.user.email;
  if (!email?.dueAt) return null;
  return email.address === null
    ? { kind: 'emailMissing', dueAt: email.dueAt }
    : { kind: 'emailUnverified', dueAt: email.dueAt };
}

/** Ansicht, die eine Mahnung behebt. */
export function alertView(alert: AccountAlert): AccountView {
  return alert.kind === 'name' ? 'name' : 'email';
}

/** Kurzzeile unter dem Namen auf der Plakette. */
export function alertLine(alert: AccountAlert): string {
  switch (alert.kind) {
    case 'name':
      return t('menu.plate.alertName');
    case 'emailMissing':
      return t('menu.plate.alertEmailMissing', { date: dateText(alert.dueAt) });
    case 'emailUnverified':
      return t('menu.plate.alertEmail', { date: dateText(alert.dueAt) });
  }
}

/** Wert und Zusatz der Zeile „E-Mail“ im Reiter Zugang. */
export function emailRow(email: EmailState): { value: string; note: string; urgent: boolean } {
  const value = email.address ?? t('konto.access.emailNone');
  if (email.pending !== null) {
    return {
      value,
      note: t('konto.access.emailPending'),
      urgent: false,
    };
  }
  if (email.verified) return { value, note: t('konto.access.emailVerified'), urgent: false };
  if (email.dueAt !== null) {
    const date = dateText(email.dueAt);
    return {
      value,
      note: t(email.address === null ? 'konto.access.emailMissingDue' : 'konto.access.emailDue', {
        date,
      }),
      urgent: true,
    };
  }
  return {
    value,
    note: email.address === null ? '' : t('konto.access.emailUnverified'),
    urgent: false,
  };
}

/** Kasten oben in der Ansicht „E-Mail-Adresse“: Stand mit Titel und Text. */
export function emailStatus(email: EmailState): {
  tone: 'done' | 'wait' | 'warn';
  title: string;
  text: string;
} {
  if (email.verified && email.pending === null) {
    return {
      tone: 'done',
      title: t('konto.email.verifiedTitle'),
      text: t('konto.email.verifiedText'),
    };
  }
  if (email.pending !== null) {
    return {
      tone: 'wait',
      title: t('konto.email.pendingTitle'),
      text: t('konto.email.pendingText', {
        email: email.pending,
        current: email.address ?? '',
      }),
    };
  }
  if (email.address === null) {
    return email.dueAt === null
      ? { tone: 'wait', title: t('konto.email.missingTitle'), text: t('konto.email.missingText') }
      : {
          tone: 'warn',
          title: t('konto.email.missingTitle'),
          text: t('konto.email.missingDueText', { date: dateText(email.dueAt, true) }),
        };
  }
  if (email.dueAt === null) {
    return {
      tone: 'wait',
      title: t('konto.email.waitingTitle'),
      text: t('konto.email.waitingText'),
    };
  }
  return {
    tone: 'warn',
    title: t('konto.email.dueTitle', { date: dateText(email.dueAt, true) }),
    text: t('konto.email.dueText', { email: email.address }),
  };
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
  // Der Benutzername steht seit ADR-082 groß darüber; hier genügt der Stand
  return me.user.isGuest ? t('konto.status.guest') : t('konto.status.secured');
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
