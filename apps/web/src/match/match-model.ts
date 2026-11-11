import {
  DEFAULT_MATCH_RULES,
  PLAYTEST_MATCH_RULES,
  type MatchEventOf,
  type MatchPresentedQuestion,
  type MatchRules,
  type MatchRulesPreset,
  type MatchView,
  type ParsedMatchEvent,
} from '@rdw/protocol';

/**
 * Reine Ableitungen für die Partie im Browser: was der Bildschirm gerade zeigt, wann die Frage
 * abgeholt wird und welche Ereignisse zur Auflösung gehören. Entschieden wird alles auf dem
 * Server; der Client zeigt nur an (ARCHITECTURE §1.6).
 */

/** Abfrageabstand bis zum WebSocket (M3): schnell genug für 2 s Auflösung im Spieltest. */
export const POLL_RUNNING_MS = 750;
export const POLL_LOBBY_MS = 1500;

/** Nächste Abfrage in ms; `null` = nicht mehr nötig (Partie beendet oder abgebrochen). */
export function pollDelay(view: MatchView): number | null {
  switch (view.match.status) {
    case 'LOBBY':
      return POLL_LOBBY_MS;
    case 'RUNNING':
      return POLL_RUNNING_MS;
    case 'FINISHED':
    case 'ABANDONED':
      return null;
  }
}

export function rulesOf(preset: MatchRulesPreset): MatchRules {
  return preset === 'PLAYTEST' ? PLAYTEST_MATCH_RULES : DEFAULT_MATCH_RULES;
}

/** Die eigene Frage, wie dieser Browser sie abgeholt hat. */
export interface LocalQuestion {
  readonly seq: number;
  /** `null`, wenn das Abholen scheiterte (etwa weil die Frage schon geschlossen war). */
  readonly question: MatchPresentedQuestion | null;
  /** `performance.now()` beim Anzeigen und am Ende der eigenen Antwortzeit. */
  readonly shownAt: number;
  readonly deadline: number;
  /** Erneut abgeholt (Reload): Dann zählt nur die Zeit des Servers. */
  readonly reloaded: boolean;
  readonly status: 'OPEN' | 'ANSWERED' | 'MISSED';
  /** Eigene Antwort, sobald sie abgeschickt ist: Die Fragekarte zeigt sie bis zur Auflösung. */
  readonly sent?: LocalAnswer | undefined;
}

/** Was dieser Browser geantwortet hat: die gewählte Option oder die geschriebene Zahl. */
export interface LocalAnswer {
  readonly optionToken?: string;
  readonly rawInput?: string;
}

export type MatchScreenState =
  | 'loading'
  | 'lobby'
  | 'pick'
  | 'waiting-pick'
  /** Ansage (ADR-053): Die Karte zeigt die Wahl eines Bots oder den Angriff vor der Frage. */
  | 'announce'
  | 'presenting'
  | 'question'
  | 'answered'
  | 'missed'
  | 'spectating'
  | 'reveal'
  | 'finished'
  | 'abandoned';

/** Muss dieser Browser die laufende Frage jetzt abholen? */
export function needsPresent(view: MatchView, local: LocalQuestion | null): boolean {
  const question = view.question;
  return (
    view.match.status === 'RUNNING' &&
    view.phase?.kind === 'QUESTION' &&
    question !== null &&
    !question.resolved &&
    (question.myStatus === 'NOT_PRESENTED' || question.myStatus === 'PRESENTED') &&
    local?.seq !== question.seq
  );
}

export function screenStateOf(
  view: MatchView | null,
  local: LocalQuestion | null,
): MatchScreenState {
  if (!view) return 'loading';
  switch (view.match.status) {
    case 'LOBBY':
      return 'lobby';
    case 'FINISHED':
      return 'finished';
    case 'ABANDONED':
      return 'abandoned';
    case 'RUNNING':
      break;
  }
  switch (view.phase?.kind) {
    case 'PICK':
      return view.legalRegions.length > 0 ? 'pick' : 'waiting-pick';
    case 'REVEAL':
      return 'reveal';
    case 'ANNOUNCE':
      return 'announce';
    // Rüstzeit der Partie mit Ausbau (MATCH_RULES §11): Der Browser zeigt sie erst im nächsten Schritt
    case 'PREPARE':
      return 'loading';
    case 'QUESTION': {
      const question = view.question;
      if (!question) return 'presenting';
      if (question.myStatus === 'NOT_PARTICIPATING') return 'spectating';
      const mine = local?.seq === question.seq ? local : null;
      if (question.myStatus === 'ANSWERED' || mine?.status === 'ANSWERED') return 'answered';
      if (question.myStatus === 'MISSED' || mine?.status === 'MISSED') return 'missed';
      return mine?.question ? 'question' : 'presenting';
    }
    case undefined:
      return 'loading';
  }
}

/** Jüngstes Ereignis eines Typs. */
export function lastOf<T extends ParsedMatchEvent['type']>(
  events: readonly ParsedMatchEvent[],
  type: T,
): Extract<ParsedMatchEvent, { type: T }> | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.type === type) return event as Extract<ParsedMatchEvent, { type: T }>;
  }
  return null;
}

/** Wahl, die eine Ansage gerade zeigt: das jüngste Ereignis, sofern es eine Wahl war. */
export type ShownPick = MatchEventOf<'CAPITAL_CHOSEN'> | MatchEventOf<'REGION_CLAIMED'>;

export function shownPick(events: readonly ParsedMatchEvent[]): ShownPick | null {
  const last = events.at(-1);
  return last?.type === 'CAPITAL_CHOSEN' || last?.type === 'REGION_CLAIMED' ? last : null;
}

/** Duell, das die Karte hervorhebt: Angreifer, Verteidiger und umkämpfte Region. */
export interface DuelFocus {
  readonly attacker: number;
  readonly defender: number;
  readonly region: number;
}

/** Ausgang des Duells, das eine Auflösung entschieden hat. */
export function duelResolved(reveal: Reveal | null): MatchEventOf<'DUEL_RESOLVED'> | null {
  return (
    reveal?.outcome.find((o): o is MatchEventOf<'DUEL_RESOLVED'> => o.type === 'DUEL_RESOLVED') ??
    null
  );
}

/**
 * Das laufende Duell aus dem Schritt; in der Auflösung das eben entschiedene, damit die Karte es
 * zeigt, bis es weitergeht.
 */
export function duelFocus(view: MatchView, reveal: Reveal | null): DuelFocus | null {
  const step = view.board?.step;
  if (step && step.attacker !== null && step.defender !== null && step.region !== null) {
    return { attacker: step.attacker, defender: step.defender, region: step.region };
  }
  const resolved = duelResolved(reveal)?.payload;
  return resolved
    ? { attacker: resolved.attacker, defender: resolved.defender, region: resolved.region }
    : null;
}

/**
 * Was die Karte von einem Duell zeigt (docs/ART_DIRECTION.md §4):
 * `announce` der Aufmarsch vor der Frage, `duel` das stehende Bild, solange gefragt wird,
 * `outcome` der Ausgang direkt nach der Entscheidung, `settled` der Rest der Auflösung.
 */
export type DuelScene = 'announce' | 'duel' | 'outcome' | 'settled';

export type DuelEffect = MatchEventOf<'DUEL_RESOLVED'>['payload']['effect'];

export interface DuelStage extends DuelFocus {
  readonly scene: DuelScene;
  /** Sieger und Wirkung, sobald das Duell entschieden ist. */
  readonly winner: number | null;
  readonly effect: DuelEffect | null;
}

/**
 * Bühne des Duells auf der Karte. `outcomeBeat` sagt, ob der Ausgang gerade gezeigt wird (der
 * erste Takt der Auflösung, siehe `outcomeBeatMs`).
 */
export function duelStage(
  view: MatchView,
  state: MatchScreenState,
  reveal: Reveal | null,
  outcomeBeat: boolean,
): DuelStage | null {
  const focus = duelFocus(view, reveal);
  if (!focus) return null;
  const resolved = state === 'reveal' ? duelResolved(reveal)?.payload : undefined;
  if (resolved) {
    return {
      attacker: resolved.attacker,
      defender: resolved.defender,
      region: resolved.region,
      scene: outcomeBeat ? 'outcome' : 'settled',
      winner: resolved.winner === 'ATTACKER' ? resolved.attacker : resolved.defender,
      effect: resolved.effect,
    };
  }
  return {
    ...focus,
    scene: state === 'announce' ? 'announce' : 'duel',
    winner: null,
    effect: null,
  };
}

/** Längster erster Takt der Auflösung: Die Karte zeigt den Ausgang, erst danach die Antworten. */
export const OUTCOME_BEAT_MS = 1500;

/**
 * Dauer des ersten Takts aus der Zeit der Auflösung: ein Viertel, höchstens `OUTCOME_BEAT_MS`.
 * Mit Spieltestzeiten (2 s Auflösung) bleibt eine halbe Sekunde.
 */
export function outcomeBeatMs(revealMs: number): number {
  return Math.min(OUTCOME_BEAT_MS, Math.round(revealMs / 4));
}

/** Ereignisse, die auf die Auflösung einer Frage folgen, bis zur nächsten Frage. */
export type RevealOutcome =
  MatchEventOf<'LAND_RANKED'> | MatchEventOf<'DUEL_RESOLVED'> | MatchEventOf<'KINGDOM_ELIMINATED'>;

export interface Reveal {
  readonly opened: MatchEventOf<'QUESTION_OPENED'> | null;
  readonly resolved: MatchEventOf<'QUESTION_RESOLVED'>;
  readonly outcome: readonly RevealOutcome[];
}

/** Auflösung der Frage `seq` mit ihren Folgen (Rangfolge der Landnahme, Duellausgang). */
export function revealFor(events: readonly ParsedMatchEvent[], seq: number): Reveal | null {
  const index = events.findIndex((e) => e.type === 'QUESTION_RESOLVED' && e.payload.seq === seq);
  const resolved = events[index];
  if (index < 0 || resolved?.type !== 'QUESTION_RESOLVED') return null;
  const opened =
    events.find(
      (e): e is MatchEventOf<'QUESTION_OPENED'> =>
        e.type === 'QUESTION_OPENED' && e.payload.seq === seq,
    ) ?? null;
  const outcome: RevealOutcome[] = [];
  for (const event of events.slice(index + 1)) {
    if (event.type === 'QUESTION_OPENED') break;
    if (
      event.type === 'LAND_RANKED' ||
      event.type === 'DUEL_RESOLVED' ||
      event.type === 'KINGDOM_ELIMINATED'
    ) {
      outcome.push(event);
    }
  }
  return { opened, resolved, outcome };
}
