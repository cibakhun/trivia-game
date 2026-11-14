import {
  DEFAULT_MATCH_RULES,
  PLAYTEST_MATCH_RULES,
  type MatchEventOf,
  type MatchPresentedQuestion,
  type MatchRules,
  type MatchRulesPreset,
  type MatchStepView,
  type MatchView,
  type ParsedMatchEvent,
  type RealmStepView,
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

/**
 * Die laufende Frage, wie ein Zuschauer sie mitliest (ADR-065): Frage und Antworten, ohne eigene
 * Antwortzeit. Was die Gefragten wählen, zeigt erst die Auflösung.
 */
export interface WatchedQuestion {
  readonly seq: number;
  /** `null`, wenn das Mitlesen scheiterte (Frage schon geschlossen, Server kennt es noch nicht). */
  readonly question: MatchPresentedQuestion | null;
  /** Ende des Zeitlimits der Frage als `performance.now()`-Wert. */
  readonly deadline: number;
}

/** Was dieser Browser geantwortet hat: die gewählte Option oder die geschriebene Zahl. */
export interface LocalAnswer {
  readonly optionToken?: string;
  readonly rawInput?: string;
}

function sameAnswer(a: LocalAnswer, b: LocalAnswer): boolean {
  return a.optionToken === b.optionToken && a.rawInput === b.rawInput;
}

/**
 * Lehnt der Server eine Antwort ab, weil unter ihrem Schlüssel schon eine andere zählt, dann zählt
 * eine der früheren, deren Bestätigung verloren ging (`lost`). Kommen mehrere in Frage, bleibt es
 * bei `undefined`: Die Fragekarte zeigt dann lieber keine Antwort als eine, die nicht zählt.
 */
export function countedAnswer(
  lost: readonly LocalAnswer[],
  refused: LocalAnswer,
): LocalAnswer | undefined {
  const others = lost.filter((answer) => !sameAnswer(answer, refused));
  const first = others[0];
  return first && others.every((answer) => sameAnswer(answer, first)) ? first : undefined;
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
  | 'abandoned'
  // Partie mit Ausbau (MATCH_RULES §11), siehe `realmScreenStateOf`
  /** Rüstzeit: Die eigenen Befehle sind noch offen. */
  | 'prepare'
  /** Rüstzeit: Die eigenen Befehle sind abgegeben, andere rüsten noch. */
  | 'prepared'
  /** Rüstzeit anderer: das eigene Reich ist gefallen. */
  | 'watching-prepare'
  /** Aufdecken: Die Befehle aller Reiche stehen kurz auf der Karte. */
  | 'orders'
  /** Das Glücksrad eines Duells dreht und zeigt die Kategorie. */
  | 'wheel';

/** Schritt der Partie, ohne oder mit Ausbau. */
export type AnyStep = MatchStepView | RealmStepView;

export function stepOf(view: MatchView | null): AnyStep | null {
  return view?.board?.step ?? view?.realm?.board?.step ?? null;
}

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

/** Muss dieser Browser die laufende Frage zum Mitlesen holen (ADR-065)? */
export function needsWatch(view: MatchView, watched: WatchedQuestion | null): boolean {
  const question = view.question;
  return (
    view.match.status === 'RUNNING' &&
    view.phase?.kind === 'QUESTION' &&
    question !== null &&
    !question.resolved &&
    question.myStatus === 'NOT_PARTICIPATING' &&
    watched?.seq !== question.seq
  );
}

/** Die mitgelesene Frage, solange dieser Sitz der laufenden Frage zuschaut; sonst `null`. */
export function watchedFor(
  state: MatchScreenState,
  seq: number | null,
  watched: WatchedQuestion | null,
): {
  readonly seq: number;
  readonly question: MatchPresentedQuestion;
  readonly deadline: number;
} | null {
  return state === 'spectating' && watched?.question && watched.seq === seq
    ? { seq: watched.seq, question: watched.question, deadline: watched.deadline }
    : null;
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
    // Rüstzeit der Partie mit Ausbau (MATCH_RULES §11): Wer rüstet, sagt `realmScreenStateOf`
    case 'PREPARE':
      return 'watching-prepare';
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
export type ShownPick =
  | MatchEventOf<'CAPITAL_CHOSEN'>
  | MatchEventOf<'REGION_CLAIMED'>
  | MatchEventOf<'CASTLE_CHOSEN'>
  | MatchEventOf<'VILLAGE_CHOSEN'>;

export function shownPick(events: readonly ParsedMatchEvent[]): ShownPick | null {
  const last = events.at(-1);
  return last?.type === 'CAPITAL_CHOSEN' ||
    last?.type === 'REGION_CLAIMED' ||
    last?.type === 'CASTLE_CHOSEN' ||
    last?.type === 'VILLAGE_CHOSEN'
    ? last
    : null;
}

/** Duell, das die Karte hervorhebt: Angreifer, Verteidiger und umkämpfte Region. */
export interface DuelFocus {
  readonly attacker: number;
  /** `null` = Angriff auf ein freies Feld (Partie mit Ausbau, O-37): Niemand verteidigt. */
  readonly defender: number | null;
  readonly region: number;
}

/** Entschiedenes Duell, ohne oder mit Ausbau. */
export type DuelResolved = MatchEventOf<'DUEL_RESOLVED'> | MatchEventOf<'REALM_DUEL_RESOLVED'>;

/** Ausgang des Duells, das eine Auflösung entschieden hat. */
export function duelResolved(reveal: Reveal | null): DuelResolved | null {
  return (
    reveal?.outcome.find(
      (o): o is DuelResolved => o.type === 'DUEL_RESOLVED' || o.type === 'REALM_DUEL_RESOLVED',
    ) ?? null
  );
}

/**
 * Das laufende Duell aus dem Schritt; in der Auflösung das eben entschiedene, damit die Karte es
 * zeigt, bis es weitergeht.
 */
export function duelFocus(view: MatchView, reveal: Reveal | null): DuelFocus | null {
  const step = stepOf(view);
  // Ein Ziel steht nur in den Schritten eines Duells; ohne Verteidiger ist es ein freies Feld
  if (step && step.attacker !== null && step.region !== null) {
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

/**
 * Wirkung auf der Karte. Mit Ausbau zeigt sie dieselben vier Bilder: Ein beschädigtes Gebäude und
 * eine getroffene Burg sind ein Treffer ohne Besitzerwechsel, eine zerstörte Burg ist eine
 * Eroberung.
 */
export type DuelEffect = MatchEventOf<'DUEL_RESOLVED'>['payload']['effect'];

export function duelEffect(effect: DuelResolved['payload']['effect']): DuelEffect {
  switch (effect) {
    case 'BUILDING_DAMAGED':
    case 'CASTLE_HIT':
      return 'CAPITAL_HIT';
    // Ein freies Feld wird genommen wie ein erobertes; bleibt es frei, prallt der Angriff ab
    case 'CASTLE_DESTROYED':
    case 'CLAIMED':
      return 'CONQUERED';
    case 'UNCLAIMED':
      return 'FORTIFIED';
    case 'CONQUERED':
    case 'CAPITAL_HIT':
    case 'TAKEOVER':
    case 'FORTIFIED':
      return effect;
  }
}

/** Sitz des Siegers; `null`, wenn ein freies Feld frei bleibt (niemand gewinnt). */
export function duelWinner(payload: DuelResolved['payload']): number | null {
  return payload.winner === 'ATTACKER'
    ? payload.attacker
    : payload.winner === 'DEFENDER'
      ? payload.defender
      : null;
}

export interface DuelStage extends DuelFocus {
  readonly scene: DuelScene;
  /** Sieger, sobald das Duell entschieden ist; `null` auch, wenn ein freies Feld frei bleibt. */
  readonly winner: number | null;
  /** Entschieden, und der Angriff ist gescheitert: Der Verteidiger hält oder das Feld bleibt frei. */
  readonly repelled: boolean;
  readonly effect: DuelEffect | null;
}

/**
 * Bühne des Duells auf der Karte. `outcomeBeat` sagt, ob der Ausgang gerade gezeigt wird (der
 * zweite Takt der Auflösung, siehe `revealPlan`).
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
      winner: duelWinner(resolved),
      repelled: resolved.winner !== 'ATTACKER',
      effect: duelEffect(resolved.effect),
    };
  }
  return {
    ...focus,
    scene: state === 'announce' || state === 'wheel' ? 'announce' : 'duel',
    winner: null,
    repelled: false,
    effect: null,
  };
}

/**
 * Takte einer Auflösung, die ein Duell entschieden hat (ADR-069): zuerst die Antworten auf dem
 * Blatt mitten auf der Karte (`answers`), solange zeigt die Karte den Stand vor dem Ausgang; dann
 * spielt die Karte den Ausgang (`outcome`); den Rest der Zeit steht das Ergebnis (`settled`).
 */
export type RevealBeat = 'answers' | 'outcome' | 'settled';

/** Längster Takt der Antworten und kürzester, für den sich das Blatt noch lohnt. */
export const ANSWERS_BEAT_MS = 4000;
export const ANSWERS_BEAT_MIN_MS = 400;

/**
 * Dauer des Takts der Antworten aus der Zeit, die von der Auflösung übrig ist: die Hälfte,
 * höchstens `ANSWERS_BEAT_MS`. Bleibt dafür zu wenig (die Seite kam spät in die Auflösung), entfällt
 * er (0).
 */
export function answersBeatMs(leftMs: number): number {
  const ms = Math.min(ANSWERS_BEAT_MS, Math.round(leftMs / 2));
  return ms >= ANSWERS_BEAT_MIN_MS ? ms : 0;
}

/** Längster Takt des Ausgangs: Die Karte spielt ab, was aus den Antworten folgt. */
export const OUTCOME_BEAT_MS = 1500;

/**
 * Dauer des Takts des Ausgangs aus der Zeit der Auflösung: ein Viertel, höchstens
 * `OUTCOME_BEAT_MS`. Mit Spieltestzeiten (2 s Auflösung) bleibt eine halbe Sekunde.
 */
export function outcomeBeatMs(revealMs: number): number {
  return Math.min(OUTCOME_BEAT_MS, Math.round(revealMs / 4));
}

/** Wann die Takte einer Auflösung wechseln, als `performance.now()`-Werte. */
export interface RevealPlan {
  readonly outcomeAt: number;
  readonly settledAt: number;
}

/**
 * Zeitplan der Takte ab `now`. `deadline` ist das Ende der Auflösung (`null` = unbekannt),
 * `revealMs` ihre ganze Dauer. `null`, wenn für die Antworten keine Zeit mehr bleibt: Dann steht
 * die Karte gleich im Ergebnis.
 */
export function revealPlan(
  now: number,
  deadline: number | null,
  revealMs: number,
): RevealPlan | null {
  const answers = answersBeatMs(deadline === null ? Number.POSITIVE_INFINITY : deadline - now);
  if (answers <= 0) return null;
  const outcomeAt = now + answers;
  return { outcomeAt, settledAt: outcomeAt + outcomeBeatMs(revealMs) };
}

/** Frage, deren laufende Auflösung ein Duell entschieden hat; sonst `null`. */
export function decidedSeq(
  view: MatchView | null,
  events: readonly ParsedMatchEvent[],
): number | null {
  if (view?.match.status !== 'RUNNING' || view.phase?.kind !== 'REVEAL' || !view.question) {
    return null;
  }
  return duelResolved(revealFor(events, view.question.seq)) ? view.question.seq : null;
}

/**
 * Was die Bühne im Takt der Antworten zeigt: die Auflösung der Frage ohne ihre Folgen. Karte,
 * Vorräte und Zugfolge kommen aus `before`, der letzten Ansicht, solange die Frage lief; die
 * Ereignisse enden mit der Auflösung der Frage. Alles, was danach kam (Ausgang des Duells,
 * gefallenes Reich, Einkommen, Ende der Partie), sieht die Bühne erst mit dem nächsten Takt: So
 * laufen Karte, Tafeln, Bänder und Klänge von selbst in der richtigen Reihenfolge.
 */
export function answersFeed(
  view: MatchView,
  events: readonly ParsedMatchEvent[],
  before: MatchView,
): { readonly view: MatchView; readonly events: readonly ParsedMatchEvent[] } {
  const seq = view.question?.seq;
  const index = events.findIndex((e) => e.type === 'QUESTION_RESOLVED' && e.payload.seq === seq);
  return {
    view: { ...view, board: before.board, realm: before.realm, legalRegions: [] },
    events: index < 0 ? events : events.slice(0, index + 1),
  };
}

/** Ereignisse, die auf die Auflösung einer Frage folgen, bis zur nächsten Frage. */
export type RevealOutcome =
  | MatchEventOf<'LAND_RANKED'>
  | MatchEventOf<'START_RANKED'>
  | DuelResolved
  | MatchEventOf<'KINGDOM_ELIMINATED'>;

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
      event.type === 'START_RANKED' ||
      event.type === 'DUEL_RESOLVED' ||
      event.type === 'REALM_DUEL_RESOLVED' ||
      event.type === 'KINGDOM_ELIMINATED'
    ) {
      outcome.push(event);
    }
  }
  return { opened, resolved, outcome };
}
