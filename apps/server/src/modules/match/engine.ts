import { newId, type Tx } from '@rdw/db';
import {
  absDecimal,
  applyMatchInput,
  autoPickRegion,
  chooseRegionForBot,
  createRng,
  currentChooser,
  deriveSeed,
  difficultyToB,
  formatDecimal,
  generateNpcEstimate,
  generateNpcTrivia,
  MATCH_BOT_PROFILES,
  matchStandings,
  parseDecimal,
  pendingQuestion,
  pickQuestion,
  RNG_VERSION,
  subtractDecimal,
  type MatchEstimateAnswer,
  type MatchEvent,
  type MatchInput,
  type MatchState,
  type QuestionCandidate,
  type Rng,
} from '@rdw/game-core';
import type { QuestionKind } from '@rdw/protocol';
import { randomInt } from 'node:crypto';
import { sql } from 'kysely';
import { readGameNow } from '../../infra/clock.ts';
import { randomToken } from '../../infra/crypto.ts';
import { ApiError } from '../../infra/errors.ts';
import { loadCandidates, loadQuestionContent, type QuestionContent } from '../quiz/questions.ts';
import {
  appendMatchEvents,
  loadMatch,
  loadPlayers,
  saveMatch,
  type MatchEventInput,
  type MatchPlayerRow,
  type MatchRow,
} from './store.ts';

/**
 * Ablauf einer laufenden Partie (MATCH_RULES §3–§5, ADR-049). Die Regeln stehen in der
 * Zustandsmaschine aus game-core; hier kommen Zeit, Fragen, Bots und Speicherung dazu:
 *
 * - **PICK:** ein Mensch wählt bis zur Frist, sonst wählt der Server zufällig (`autoPickRegion`).
 *   Bots wählen sofort; ihre Wahl bleibt danach kurz stehen (ANNOUNCE).
 * - **ANNOUNCE:** Ansage ohne Eingabe (ADR-053): Die Karte zeigt, was zuletzt gewählt wurde oder
 *   wer wen wo angreift; nach der Frist geht es weiter. Vor jedem Duell und nach jeder Wahl, außer
 *   derselbe Mensch wählt gleich noch einmal.
 * - **QUESTION:** eine Frage an die Sitze des Schritts; aufgelöst wird, sobald alle Menschen
 *   geantwortet haben oder die Frage schließt. Bot-Antworten stehen beim Öffnen fest.
 * - **REVEAL:** die Auflösung bleibt `revealMs` stehen, dann folgt der nächste Schritt.
 *
 * Alles läuft in der Transaktion des Aufrufers, der die Sperre auf die Partie hält. Ein Neustart
 * verliert nichts: Phase und Frist stehen in der Zeile, die Ablaufsteuerung macht dort weiter.
 */

export interface MatchEngineContext {
  readonly rngSecret: Uint8Array;
  readonly rngKeyId: string;
  /** Testfragen erlaubt (nur local und test, ADR-021). */
  readonly allowFixtures: boolean;
}

/** Zeit, die ein Client nach dem Öffnen einer Frage zum Abholen hat, ohne Zeit zu verlieren [E]. */
export const PRESENT_GRACE_MS = 2_000;

/**
 * Aufgelöst wird erst so lange nach `closes_at`: Eine Antwort, die vor ihrer Frist einging, aber
 * auf die Sperre der Partie warten musste, zählt noch (wie `settleGrace` bei Kämpfen) [E].
 */
export const RESOLVE_GRACE_MS = 1_000;

/** Fragenmischung der Partie: wie Regionsstufe 3–6, also gemischt (QUIZ_ENGINE §5.1) [E]. */
export const MATCH_QUESTION_WEIGHTS = Object.freeze({ EASY: 0.3, MEDIUM: 0.4, HARD: 0.3 });

/** Höchstzahl an Schritten je Durchlauf; schützt vor Endlosschleifen bei einem Programmfehler. */
const MAX_STEPS_PER_RUN = 200;

const BOT_NAMES = { EASY: 'leicht', MEDIUM: 'mittel', HARD: 'schwer' } as const;

/** Anzeigename eines Bots; `number` unterscheidet gleich starke Bots einer Partie. */
export function botName(strength: keyof typeof BOT_NAMES, number?: number): string {
  return `Bot${number === undefined ? '' : ` ${number}`} (${BOT_NAMES[strength]})`;
}

export type QuestionPurpose = 'LAND' | 'DUEL_TRIVIA' | 'DUEL_ESTIMATE';

interface Presentation {
  readonly options: readonly { readonly token: string; readonly key: string }[];
}

export function readPresentation(value: unknown): Presentation {
  const options = (value as { options?: unknown } | null)?.options;
  if (!Array.isArray(options)) return { options: [] };
  return {
    options: options.flatMap((o: unknown) => {
      const entry = o as { token?: unknown; key?: unknown };
      return typeof entry.token === 'string' && typeof entry.key === 'string'
        ? [{ token: entry.token, key: entry.key }]
        : [];
    }),
  };
}

function newPresentation(content: QuestionContent): Record<string, unknown> {
  if (content.kind === 'ESTIMATE') return { kind: 'ESTIMATE' };
  const keys = content.options.map((o) => o.key);
  for (let i = keys.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [keys[i], keys[j]] = [keys[j] as string, keys[i] as string];
  }
  return { kind: 'TRIVIA', options: keys.map((key) => ({ token: randomToken(8), key })) };
}

function purposeOf(state: MatchState): QuestionPurpose {
  switch (state.step.kind) {
    case 'LAND_ESTIMATE':
      return 'LAND';
    case 'DUEL_TRIVIA':
      return 'DUEL_TRIVIA';
    case 'DUEL_ESTIMATE':
      return 'DUEL_ESTIMATE';
    case 'CAPITAL_PICK':
    case 'LAND_PICK':
    case 'CAMPAIGN_TARGET':
    case 'FINISHED':
      throw new Error(`Im Schritt ${state.step.kind} gibt es keine Frage`);
  }
}

/** Ein Durchgang an einer gesperrten Partie: sammelt Ereignisse und schreibt sie am Ende. */
export class MatchRun {
  private readonly events: MatchEventInput[] = [];
  private steps = 0;

  constructor(
    readonly tx: Tx,
    readonly ctx: MatchEngineContext,
    readonly match: MatchRow,
    readonly players: readonly MatchPlayerRow[],
    readonly now: Date,
  ) {}

  emit(type: string, payload: Record<string, unknown>): void {
    this.events.push({ type, payload });
  }

  /** Ereignisse und Zeile schreiben; liefert die letzte Ereignisnummer. */
  async commit(): Promise<number> {
    const last = await appendMatchEvents(this.tx, this.match.id, this.events);
    this.events.length = 0;
    await saveMatch(this.tx, this.match);
    return last;
  }

  /** Sitz eines Kontos; `null` vor dem Start oder ohne Teilnahme. */
  seatOf(userId: string): number | null {
    return this.players.find((p) => p.userId === userId)?.seat ?? null;
  }

  get state(): MatchState {
    if (!this.match.state) throw new Error('Partie ohne Zustand');
    return this.match.state;
  }

  get rules() {
    return this.state.rules;
  }

  playerAt(seat: number): MatchPlayerRow {
    const player = this.players.find((p) => p.seat === seat);
    if (!player) throw new Error(`Sitz ${seat} ohne Teilnehmer`);
    return player;
  }

  humanUserIds(): string[] {
    return this.players.flatMap((p) => (p.userId === null ? [] : [p.userId]));
  }

  /** Nächster Zufallsstrom `match` der Partie (Wahl nach Zeitablauf, Bot-Wahl), mit Protokoll. */
  async drawRng(label: 'auto' | 'bot'): Promise<{ rng: Rng; entityId: string }> {
    this.match.draws += 1;
    const entityId = `${this.match.id}.${label}${this.match.draws}`;
    return { rng: createRng(await deriveSeed(this.ctx.rngSecret, 'match', entityId)), entityId };
  }

  private guard(): void {
    this.steps += 1;
    if (this.steps > MAX_STEPS_PER_RUN) throw new Error('Partie kommt nicht zur Ruhe');
  }

  /** Wendet eine Eingabe an; Fehler sind Programmfehler, außer bei Wahlen von Menschen. */
  apply(input: MatchInput): void {
    const result = applyMatchInput(this.state, input);
    if (!result.ok) {
      if (result.error === 'INVALID_REGION') {
        throw new ApiError(422, 'INVALID_REGION', 'Diese Region ist nicht wählbar');
      }
      if (result.error === 'NOT_YOUR_TURN') {
        throw new ApiError(409, 'NOT_YOUR_TURN', 'Ein anderer Sitz ist dran');
      }
      throw new Error(`Eingabe ${input.kind} abgelehnt: ${result.error}`);
    }
    this.match.state = result.state;
    for (const event of result.events) this.emit(event.kind, eventPayload(event));
  }

  /**
   * Hält die Partie für eine Ansage an (ADR-053); `false`, wenn die Regeln keine vorsehen (Partien
   * von vor ADR-053 oder Dauer 0).
   */
  private announce(durationMs: number | undefined): boolean {
    if (durationMs === undefined || durationMs <= 0) return false;
    this.match.phase = 'ANNOUNCE';
    this.match.phaseDeadlineAt = new Date(this.now.getTime() + durationMs);
    return true;
  }

  /** Dauer der Ansage vor dem aktuellen Schritt: ein Duell wird länger angesagt als eine Wahl. */
  private announceMsFor(state: MatchState): number | undefined {
    const { timers } = this.rules;
    return state.step.kind === 'DUEL_TRIVIA' ? timers.announceMs : timers.pickShowMs;
  }

  /**
   * Beginnt den aktuellen Schritt: Bots wählen sofort, Menschen bekommen eine Frist, Fragen werden
   * geöffnet. Läuft weiter, solange nichts auf einen Menschen oder eine Ansage wartet.
   *
   * `picker` ist der Sitz eines Menschen, dessen Wahl (auch die des Servers nach Zeitablauf)
   * diesem Aufruf unmittelbar vorausging: Sie bleibt als Ansage stehen, bevor ein anderer Sitz
   * wählt oder eine Frage kommt. Nach einer Ansage oder Auflösung ist `picker` `null`.
   */
  async enterStep(picker: number | null = null): Promise<void> {
    for (;;) {
      this.guard();
      const state = this.state;
      const { step } = state;
      switch (step.kind) {
        case 'FINISHED':
          await this.finish();
          return;
        case 'CAPITAL_PICK':
        case 'LAND_PICK':
        case 'CAMPAIGN_TARGET': {
          const seat = currentChooser(state);
          if (seat === null) throw new Error('Wahl ohne Wählenden');
          // Wählt derselbe Sitz gleich noch einmal (Landnahme), geht es ohne Pause weiter
          if (picker !== null && picker !== seat && this.announce(this.rules.timers.pickShowMs)) {
            return;
          }
          const player = this.playerAt(seat);
          if (player.botStrength !== null) {
            const { rng } = await this.drawRng('bot');
            this.apply(pickInput(state, seat, chooseRegionForBot(state, rng)));
            // Die Wahl bleibt stehen, damit alle sie sehen; ein Angriff wird angesagt
            if (this.announce(this.announceMsFor(this.state))) return;
            continue;
          }
          this.match.phase = 'PICK';
          this.match.phaseDeadlineAt = new Date(
            this.now.getTime() + this.rules.timers.pickMs + this.rules.timers.latencyAllowanceCapMs,
          );
          return;
        }
        case 'LAND_ESTIMATE':
        case 'DUEL_TRIVIA':
        case 'DUEL_ESTIMATE': {
          // Nach der Wahl eines Menschen kommt die Frage nicht sofort: erst die Ansage
          if (picker !== null && this.announce(this.announceMsFor(state))) return;
          const opened = await this.openQuestion();
          if (opened === 'WAITING') return;
          if (opened === 'ABANDONED') return;
          // Nur Bots an der Frage: sofort auflösen, die Auflösung bleibt trotzdem stehen
          await this.resolveQuestion();
          return;
        }
      }
    }
  }

  /** Öffnet die Frage des Schritts; `RESOLVE_NOW`, wenn kein Mensch antworten muss. */
  private async openQuestion(): Promise<'WAITING' | 'RESOLVE_NOW' | 'ABANDONED'> {
    const state = this.state;
    const pending = pendingQuestion(state);
    if (!pending) throw new Error(`Schritt ${state.step.kind} ohne Frage`);
    const kind: QuestionKind = pending.type;
    const seq = (this.match.questionSeq ?? 0) + 1;
    const versionId = await this.chooseQuestion(kind, seq);
    if (versionId === null) {
      this.abandon('NO_QUESTION_AVAILABLE');
      return 'ABANDONED';
    }
    const content = await loadQuestionContent(this.tx, versionId);
    const { timers } = this.rules;
    const timeLimitMs = kind === 'TRIVIA' ? timers.triviaMs : timers.estimateMs;
    const closesAt = new Date(
      this.now.getTime() + timeLimitMs + timers.latencyAllowanceCapMs + PRESENT_GRACE_MS,
    );
    await this.tx
      .insertInto('match_questions')
      .values({
        match_id: this.match.id,
        seq,
        kind,
        version_id: versionId,
        purpose: purposeOf(state),
        seats: [...pending.seats],
        presentation: JSON.stringify(newPresentation(content)),
        time_limit_ms: timeLimitMs,
        opened_at: this.now,
        closes_at: closesAt,
      })
      .execute();
    // Bot-Antworten vor jeder Präsentation erzeugen und speichern (versiegelt, NPC_SYSTEM §3.4)
    for (const seat of pending.seats) {
      const player = this.playerAt(seat);
      if (player.botStrength !== null) {
        await this.insertBotAnswer(seq, seat, player.botStrength, content, timeLimitMs);
      }
    }
    this.match.questionSeq = seq;
    this.match.phase = 'QUESTION';
    this.match.phaseDeadlineAt = new Date(closesAt.getTime() + RESOLVE_GRACE_MS);
    this.emit('QUESTION_OPENED', {
      seq,
      kind,
      purpose: purposeOf(state),
      seats: [...pending.seats],
      timeLimitMs,
      closesAt: closesAt.toISOString(),
    });
    const humans = pending.seats.filter((seat) => this.playerAt(seat).userId !== null);
    return humans.length > 0 ? 'WAITING' : 'RESOLVE_NOW';
  }

  /**
   * Frage aus dem Bestand (QUIZ_ENGINE §5, Strom `question-pick` je Frage): keine, die in dieser
   * Partie schon kam, solange es andere gibt; gesehen zählt für alle Menschen der Partie.
   */
  private async chooseQuestion(kind: QuestionKind, seq: number): Promise<string | null> {
    const userIds = this.humanUserIds();
    const candidates = await loadCandidates(this.tx, {
      kind,
      userIds,
      allowFixtures: this.ctx.allowFixtures,
      now: this.now,
    });
    const used = await this.tx
      .selectFrom('match_questions as mq')
      .innerJoin('question_versions as v', 'v.id', 'mq.version_id')
      .innerJoin('questions as q', 'q.id', 'v.question_id')
      .select(['v.question_id', 'q.category', 'mq.seq'])
      .where('mq.match_id', '=', this.match.id)
      .orderBy('mq.seq', 'desc')
      .execute();
    const usedIds = new Set(used.map((u) => u.question_id));
    const fresh = candidates.filter((c: QuestionCandidate) => !usedIds.has(c.questionId));
    const pool = fresh.length > 0 ? fresh : candidates;
    const rng = createRng(
      await deriveSeed(this.ctx.rngSecret, 'question-pick', `${this.match.id}.q${seq}`),
    );
    const pick = pickQuestion(
      pool,
      {
        now: this.now.getTime(),
        weights: MATCH_QUESTION_WEIGHTS,
        recentCategories: used.map((u) => u.category),
      },
      rng,
    );
    return pick?.candidate.versionId ?? null;
  }

  private async insertBotAnswer(
    seq: number,
    seat: number,
    strength: keyof typeof MATCH_BOT_PROFILES,
    content: QuestionContent,
    timeLimitMs: number,
  ): Promise<void> {
    const profile = MATCH_BOT_PROFILES[strength];
    const entityId = `${this.match.id}.q${seq}.s${seat}`;
    const rng = createRng(await deriveSeed(this.ctx.rngSecret, 'npc-answer', entityId));
    const rngAudit = {
      purpose: 'npc-answer',
      entityId,
      keyId: this.ctx.rngKeyId,
      version: RNG_VERSION,
    };
    if (content.kind === 'TRIVIA') {
      const correct = content.options.find((o) => o.correct);
      const wrong = content.options.filter((o) => !o.correct);
      if (!correct || wrong.length === 0)
        throw new Error('Trivia ohne richtige oder falsche Option');
      const triviaB = content.calibratedDifficulty ?? difficultyToB(content.difficulty);
      const answer = generateNpcTrivia(rng, profile, triviaB, wrong.length);
      const chosen =
        answer.wrongOptionIndex === null ? correct : (wrong[answer.wrongOptionIndex] ?? correct);
      await this.tx
        .insertInto('match_answers')
        .values({
          match_id: this.match.id,
          seq,
          seat,
          status: 'GENERATED',
          answer_option_key: chosen.key,
          is_correct: chosen.correct,
          audit: JSON.stringify({
            strength,
            theta: profile.theta,
            b: triviaB,
            pCorrect: answer.pCorrect,
            draw: answer.draw,
            rng: rngAudit,
          }),
          created_at: this.now,
        })
        .execute();
      return;
    }
    const spec = content.estimate;
    if (!spec) throw new Error('Schätzfrage ohne Daten');
    const answer = generateNpcEstimate(rng, profile, spec, timeLimitMs);
    const distance = formatDecimal(
      absDecimal(subtractDecimal(answer.estimate, parseDecimal(spec.answerValue))),
    );
    await this.tx
      .insertInto('match_answers')
      .values({
        match_id: this.match.id,
        seq,
        seat,
        status: 'GENERATED',
        answer_value: formatDecimal(answer.estimate),
        distance,
        effective_ms: answer.estimateMs,
        is_correct: distance === '0',
        audit: JSON.stringify({
          strength,
          theta: profile.theta,
          spread: answer.spread,
          draws: answer.draws,
          rng: rngAudit,
        }),
        created_at: this.now,
      })
      .execute();
  }

  /**
   * Löst die laufende Frage auf: fehlende Antworten zählen als verpasst, das Ergebnis geht in die
   * Zustandsmaschine; danach steht die Auflösung `revealMs` lang. Das gilt auch für die letzte
   * Frage (ADR-055): Die Partie läuft weiter, bis alle den entscheidenden Ausgang und die Antworten
   * gesehen haben; erst `enterStep` nach der Auflösung rechnet ab.
   */
  async resolveQuestion(): Promise<void> {
    const seq = this.match.questionSeq;
    if (seq === null) throw new Error('Keine laufende Frage');
    const question = await this.tx
      .selectFrom('match_questions')
      .select(['seq', 'kind', 'version_id', 'seats', 'presentation', 'resolved_at'])
      .where('match_id', '=', this.match.id)
      .where('seq', '=', seq)
      .executeTakeFirstOrThrow();
    if (question.resolved_at !== null) throw new Error(`Frage ${seq} ist schon aufgelöst`);
    await this.tx
      .updateTable('match_answers')
      .set({ status: 'MISSED' })
      .where('match_id', '=', this.match.id)
      .where('seq', '=', seq)
      .where('status', '=', 'PRESENTED')
      .execute();
    const answered = await this.tx
      .selectFrom('match_answers')
      .select(['seat', 'status', 'answer_option_key', 'answer_value', 'distance', 'effective_ms'])
      .select('is_correct')
      .where('match_id', '=', this.match.id)
      .where('seq', '=', seq)
      .execute();
    const bySeat = new Map(answered.map((a) => [a.seat, a]));
    const missing = question.seats.filter((seat) => !bySeat.has(seat));
    if (missing.length > 0) {
      await this.tx
        .insertInto('match_answers')
        .values(
          missing.map((seat) => ({
            match_id: this.match.id,
            seq,
            seat,
            status: 'MISSED',
            created_at: this.now,
          })),
        )
        .execute();
    }
    await this.tx
      .updateTable('match_questions')
      .set({ resolved_at: this.now })
      .where('match_id', '=', this.match.id)
      .where('seq', '=', seq)
      .execute();

    const counted = (seat: number) => {
      const a = bySeat.get(seat);
      return a !== undefined && (a.status === 'ANSWERED' || a.status === 'GENERATED') ? a : null;
    };
    const estimateOf = (seat: number): MatchEstimateAnswer => {
      const a = counted(seat);
      return a === null || a.distance === null
        ? { distance: null, effectiveMs: null }
        : { distance: parseDecimal(a.distance), effectiveMs: a.effective_ms };
    };

    // Auflösung für alle: Lösung und Antworten der Sitze (erst jetzt, QUIZ_ENGINE §7.2)
    const content = await loadQuestionContent(this.tx, question.version_id);
    const presentation = readPresentation(question.presentation);
    const textOf = (key: string | null) =>
      key === null ? null : (content.options.find((o) => o.key === key)?.text ?? null);
    const correctOption = content.options.find((o) => o.correct) ?? null;
    // Frage samt Optionen für alle, auch für Sitze, die nicht antworten mussten (Zuschauer)
    this.emit('QUESTION_RESOLVED', {
      seq,
      kind: question.kind,
      prompt: content.prompt,
      options: presentation.options.map((o) => ({ token: o.token, text: textOf(o.key) })),
      solution:
        question.kind === 'TRIVIA'
          ? {
              optionToken:
                presentation.options.find((o) => o.key === correctOption?.key)?.token ?? null,
              text: correctOption?.text ?? null,
            }
          : {
              value: content.estimate?.answerValue ?? null,
              unit: content.estimate?.unitLabel ?? null,
            },
      explanation: content.explanation,
      answers: question.seats.map((seat) => {
        const a = counted(seat);
        return {
          seat,
          answered: a !== null,
          correct: a?.is_correct ?? false,
          optionText: question.kind === 'TRIVIA' ? textOf(a?.answer_option_key ?? null) : null,
          value: a?.answer_value ?? null,
          distance: a?.distance ?? null,
          effectiveMs: question.kind === 'ESTIMATE' ? (a?.effective_ms ?? null) : null,
        };
      }),
    });

    const state = this.state;
    switch (state.step.kind) {
      case 'LAND_ESTIMATE':
        this.apply({
          kind: 'LAND_ESTIMATES',
          answers: question.seats.map((seat) => ({ seat, ...estimateOf(seat) })),
        });
        break;
      case 'DUEL_TRIVIA':
        this.apply({
          kind: 'DUEL_TRIVIA',
          attackerCorrect: counted(state.step.attacker)?.is_correct === true,
          defenderCorrect: counted(state.step.defender)?.is_correct === true,
        });
        break;
      case 'DUEL_ESTIMATE':
        this.apply({
          kind: 'DUEL_ESTIMATES',
          attacker: estimateOf(state.step.attacker),
          defender: estimateOf(state.step.defender),
        });
        break;
      case 'CAPITAL_PICK':
      case 'LAND_PICK':
      case 'CAMPAIGN_TARGET':
      case 'FINISHED':
        throw new Error(`Frage ${seq} passt nicht zum Schritt ${state.step.kind}`);
    }
    this.match.phase = 'REVEAL';
    this.match.phaseDeadlineAt = new Date(this.now.getTime() + this.rules.timers.revealMs);
  }

  /**
   * Arbeitet fällige Fristen ab: Wahl nach Zeitablauf, Auflösung einer Frage, Ende der Anzeige.
   * Liefert `true`, wenn sich etwas geändert hat.
   */
  async advanceDue(): Promise<boolean> {
    let changed = false;
    while (
      this.match.status === 'RUNNING' &&
      this.match.phaseDeadlineAt !== null &&
      this.match.phaseDeadlineAt.getTime() <= this.now.getTime()
    ) {
      this.guard();
      changed = true;
      switch (this.match.phase) {
        case 'PICK': {
          const seat = currentChooser(this.state);
          if (seat === null) throw new Error('Wahl ohne Wählenden');
          const { rng, entityId } = await this.drawRng('auto');
          const region = autoPickRegion(this.state, rng);
          this.emit('AUTO_PICKED', {
            seat,
            region,
            rng: { purpose: 'match', entityId, keyId: this.ctx.rngKeyId, version: RNG_VERSION },
          });
          this.apply(pickInput(this.state, seat, region));
          await this.enterStep(seat);
          break;
        }
        case 'QUESTION':
          await this.resolveQuestion();
          break;
        case 'REVEAL':
        case 'ANNOUNCE':
          await this.enterStep();
          break;
        case null:
          throw new Error('Laufende Partie ohne Phase');
      }
    }
    return changed;
  }

  /** Wahl eines Menschen in Phase PICK. */
  async humanPick(userId: string, region: number): Promise<void> {
    if (this.match.status !== 'RUNNING') {
      throw new ApiError(409, 'MATCH_NOT_RUNNING', 'Die Partie läuft nicht', {
        status: this.match.status,
      });
    }
    if (this.match.phase !== 'PICK') {
      throw new ApiError(409, 'STEP_NOT_AVAILABLE', 'Gerade gibt es nichts zu wählen');
    }
    const seat = this.seatOf(userId);
    if (seat === null || currentChooser(this.state) !== seat) {
      throw new ApiError(409, 'NOT_YOUR_TURN', 'Ein anderer Sitz ist dran');
    }
    this.apply(pickInput(this.state, seat, region));
    await this.enterStep(seat);
  }

  /** Alle Menschen der laufenden Frage haben geantwortet: sofort auflösen. */
  async resolveIfComplete(): Promise<void> {
    if (this.match.phase !== 'QUESTION' || this.match.questionSeq === null) return;
    const seq = this.match.questionSeq;
    const question = await this.tx
      .selectFrom('match_questions')
      .select('seats')
      .where('match_id', '=', this.match.id)
      .where('seq', '=', seq)
      .executeTakeFirstOrThrow();
    const humans = question.seats.filter((seat) => this.playerAt(seat).userId !== null);
    const { done } = await this.tx
      .selectFrom('match_answers')
      .select((eb) => eb.fn.countAll<string>().as('done'))
      .where('match_id', '=', this.match.id)
      .where('seq', '=', seq)
      .where('seat', 'in', humans.length > 0 ? humans : [-1])
      .where('status', '=', 'ANSWERED')
      .executeTakeFirstOrThrow();
    if (Number(done) >= humans.length) await this.resolveQuestion();
  }

  private async finish(): Promise<void> {
    this.match.status = 'FINISHED';
    this.match.phase = null;
    this.match.phaseDeadlineAt = null;
    this.match.finishedAt = this.now;
    // Testpartien zählen nicht (ADR-048), Partien mit Bots auch nicht (ADR-052) [E]
    if (this.match.kind !== 'STANDARD' || this.players.some((p) => p.userId === null)) return;
    const finished = this.state.step;
    if (finished.kind !== 'FINISHED') throw new Error('Partie ist nicht beendet');
    const winners = new Set(
      matchStandings(this.state).flatMap((s) => (s.place === 1 ? [s.seat] : [])),
    );
    for (const player of this.players) {
      if (player.userId === null || player.seat === null) continue;
      await this.tx
        .updateTable('player_statistics')
        .set({
          matches_played: sql<number>`matches_played + 1`,
          matches_won: winners.has(player.seat)
            ? sql<number>`matches_won + 1`
            : sql<number>`matches_won`,
        })
        .where('user_id', '=', player.userId)
        .execute();
    }
  }

  /** Bricht eine laufende Partie ab: ohne passende Frage oder nach wiederholten Fehlern. */
  abandon(reason: string): void {
    this.match.status = 'ABANDONED';
    this.match.phase = null;
    this.match.phaseDeadlineAt = null;
    this.match.finishedAt = this.now;
    this.emit('MATCH_ABANDONED', { reason });
  }
}

function pickInput(state: MatchState, seat: number, region: number): MatchInput {
  switch (state.step.kind) {
    case 'CAPITAL_PICK':
      return { kind: 'PICK_CAPITAL', seat, region };
    case 'LAND_PICK':
      return { kind: 'PICK_REGION', seat, region };
    case 'CAMPAIGN_TARGET':
      return { kind: 'PICK_TARGET', seat, region };
    case 'LAND_ESTIMATE':
    case 'DUEL_TRIVIA':
    case 'DUEL_ESTIMATE':
    case 'FINISHED':
      throw new ApiError(409, 'STEP_NOT_AVAILABLE', 'Gerade gibt es nichts zu wählen');
  }
}

function eventPayload(event: MatchEvent): Record<string, unknown> {
  return Object.fromEntries(Object.entries(event).filter(([key]) => key !== 'kind'));
}

/**
 * Sperrt die Partie für einen Teilnehmer und liefert den Durchgang mit der Spielzeit nach der
 * Sperre. Wer nicht teilnimmt, bekommt „nicht gefunden“, wie bei fremden Herausforderungen.
 */
export async function lockMatchFor(
  tx: Tx,
  ctx: MatchEngineContext,
  matchId: string,
  userId: string,
): Promise<MatchRun> {
  const match = await loadMatch(tx, matchId, { lock: 'UPDATE' });
  const players = match ? await loadPlayers(tx, matchId) : [];
  if (!match || !players.some((p) => p.userId === userId)) {
    throw new ApiError(404, 'NOT_FOUND', 'Partie nicht gefunden');
  }
  return new MatchRun(tx, ctx, match, players, await readGameNow(tx));
}

/** Neue Partie-ID (UUIDv7). */
export function newMatchId(): string {
  return newId();
}
