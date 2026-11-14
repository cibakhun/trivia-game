import { newId, type Tx } from '@rdw/db';
import {
  absDecimal,
  createRng,
  deriveSeed,
  difficultyToB,
  formatDecimal,
  generateNpcEstimate,
  generateNpcTrivia,
  parseDecimal,
  pickQuestion,
  RNG_VERSION,
  subtractDecimal,
  type MatchBotStrength,
  type MatchEstimateAnswer,
  type NpcProfile,
  type QuestionCandidate,
  type Rng,
} from '@rdw/game-core';
import type {
  MatchRules,
  QuestionCategory,
  QuestionKind,
  RealmOrderDto,
  MATCH_QUESTION_PURPOSES,
} from '@rdw/protocol';
import { randomInt } from 'node:crypto';
import { sql } from 'kysely';
import { randomToken } from '../../infra/crypto.ts';
import { ApiError } from '../../infra/errors.ts';
import { loadCandidates, loadQuestionContent, type QuestionContent } from '../quiz/questions.ts';
import { botThinkMs } from './bot-think.ts';
import {
  appendMatchEvents,
  saveMatch,
  type MatchEventInput,
  type MatchPlayerRow,
  type MatchRow,
} from './store.ts';

/**
 * Ablauf einer laufenden Partie (MATCH_RULES §3–§5 und §11, ADR-049, ADR-058). Die Regeln stehen
 * in der Zustandsmaschine aus game-core; hier kommen Zeit, Fragen, Bots und Speicherung dazu.
 * `MatchRun` ist der gemeinsame Teil beider Spielarten; was vom Schritt der Zustandsmaschine
 * abhängt, liegt in `ClassicRun` (`classic-run.ts`) und `RealmRun` (`realm-run.ts`, mit Ausbau).
 *
 * - **PICK:** ein Mensch wählt bis zur Frist, sonst wählt der Server zufällig.
 *   Bots wählen sofort; ihre Wahl bleibt danach kurz stehen (ANNOUNCE).
 * - **ANNOUNCE:** Ansage ohne Eingabe (ADR-053): Die Karte zeigt, was zuletzt gewählt wurde oder
 *   wer wen wo angreift; nach der Frist geht es weiter. Vor jedem Duell und nach jeder Wahl, außer
 *   derselbe Mensch wählt gleich noch einmal.
 * - **QUESTION:** eine Frage an die Sitze des Schritts; aufgelöst wird, sobald alle Menschen
 *   geantwortet haben oder die Frage schließt. Bot-Antworten stehen beim Öffnen fest.
 * - **REVEAL:** die Auflösung bleibt `revealMs` stehen, dann folgt der nächste Schritt.
 * - **PREPARE** (nur mit Ausbau): Rüstzeit; alle Menschen geben verdeckt Befehle, bis alle fertig
 *   sind oder die Frist abläuft.
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

/** Spielzeit und Zufall je Zweck im Strom `match` der Partie. */
export type MatchDrawLabel = 'auto' | 'bot' | 'orders' | 'wheel';

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

export type QuestionPurpose = (typeof MATCH_QUESTION_PURPOSES)[number];

/** Frage, die der aktuelle Schritt stellt. */
export interface PendingMatchQuestion {
  readonly type: QuestionKind;
  readonly seats: readonly number[];
  readonly purpose: QuestionPurpose;
  /** Kategorie vom Glücksrad (Wissensfrage eines Duells mit Ausbau), sonst `null`. */
  readonly category: QuestionCategory | null;
}

/** Gewertete Antworten einer aufgelösten Frage, je Sitz. */
export interface ResolvedAnswers {
  readonly seats: readonly number[];
  /** Richtig beantwortet; verpasst zählt als falsch. */
  correct(seat: number): boolean;
  /** Abstand und Zeit der Schätzung; verpasst: beides `null`. */
  estimate(seat: number): MatchEstimateAnswer;
}

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

/** Ein Durchgang an einer gesperrten Partie: sammelt Ereignisse und schreibt sie am Ende. */
export abstract class MatchRun {
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

  /** Regeln der laufenden Partie; Zeiten, Karte und Plätze sind in beiden Spielarten gleich. */
  get rules(): MatchRules {
    if (!this.match.rules) throw new Error('Partie ohne Regeln');
    return this.match.rules;
  }

  playerAt(seat: number): MatchPlayerRow {
    const player = this.players.find((p) => p.seat === seat);
    if (!player) throw new Error(`Sitz ${seat} ohne Teilnehmer`);
    return player;
  }

  humanUserIds(): string[] {
    return this.players.flatMap((p) => (p.userId === null ? [] : [p.userId]));
  }

  /**
   * Nächster Zufallsstrom `match` der Partie (Wahl nach Zeitablauf, Bot-Wahl, Befehle eines Bots,
   * Glücksrad), mit Protokoll.
   */
  async drawRng(label: MatchDrawLabel): Promise<{ rng: Rng; entityId: string }> {
    this.match.draws += 1;
    const entityId = `${this.match.id}.${label}${this.match.draws}`;
    return { rng: createRng(await deriveSeed(this.ctx.rngSecret, 'match', entityId)), entityId };
  }

  protected guard(): void {
    this.steps += 1;
    if (this.steps > MAX_STEPS_PER_RUN) throw new Error('Partie kommt nicht zur Ruhe');
  }

  // -------------------------------------------------------------------------------------------
  // Was vom Schritt der Zustandsmaschine abhängt

  /**
   * Beginnt den aktuellen Schritt: Bots wählen sofort, Menschen bekommen eine Frist, Fragen werden
   * geöffnet. Läuft weiter, solange nichts auf einen Menschen oder eine Ansage wartet.
   *
   * `picker` ist der Sitz eines Menschen, dessen Wahl (auch die des Servers nach Zeitablauf)
   * diesem Aufruf unmittelbar vorausging: Sie bleibt als Ansage stehen, bevor ein anderer Sitz
   * wählt oder eine Frage kommt. Nach einer Ansage oder Auflösung ist `picker` `null`.
   */
  abstract enterStep(picker?: number | null): Promise<void>;

  /** Wer jetzt eine Region wählt, sonst `null`. */
  protected abstract chooser(): number | null;

  /** Zufällige wählbare Region für die Wahl nach Zeitablauf. */
  protected abstract autoPick(rng: Rng): number;

  /**
   * Trägt die Wahl einer Region im aktuellen Schritt ein; `STEP_NOT_AVAILABLE`, wenn der Schritt
   * keine Wahl ist, `INVALID_REGION` und `NOT_YOUR_TURN` nach den Regeln.
   */
  protected abstract applyPick(seat: number, region: number): void;

  /** Frage des aktuellen Schritts, sonst `null`. */
  protected abstract pendingQuestion(): PendingMatchQuestion | null;

  /** Antwortprofil eines Bots für die Frage des aktuellen Schritts. */
  protected abstract botProfile(seat: number, strength: MatchBotStrength): NpcProfile;

  /** Trägt die Antworten der aufgelösten Frage in die Zustandsmaschine ein. */
  protected abstract applyAnswers(answers: ResolvedAnswers): void;

  /** Sitze auf Platz 1 der beendeten Partie. */
  protected abstract winnerSeats(): ReadonlySet<number>;

  /** Die Frist der Rüstzeit ist abgelaufen (nur mit Ausbau). */
  protected closePrepare(): Promise<void> {
    return Promise.reject(new Error('Rüstzeit in einer Partie ohne Ausbau'));
  }

  /** Befehle eines Menschen in der Rüstzeit (nur mit Ausbau). */
  submitOrders(_userId: string, _orders: readonly RealmOrderDto[]): Promise<void> {
    return Promise.reject(
      new ApiError(409, 'STEP_NOT_AVAILABLE', 'Diese Partie hat keine Rüstzeit'),
    );
  }

  // -------------------------------------------------------------------------------------------
  // Gemeinsamer Ablauf

  /**
   * Hält die Partie für eine Ansage an (ADR-053); `false`, wenn die Regeln keine vorsehen (Partien
   * von vor ADR-053 oder Dauer 0).
   */
  protected announce(durationMs: number | undefined): boolean {
    if (durationMs === undefined || durationMs <= 0) return false;
    this.match.phase = 'ANNOUNCE';
    this.match.phaseDeadlineAt = new Date(this.now.getTime() + durationMs);
    return true;
  }

  /** Ein Mensch ist mit einer Wahl dran: Frist setzen. */
  protected awaitPick(): void {
    const { timers } = this.rules;
    this.match.phase = 'PICK';
    this.match.phaseDeadlineAt = new Date(
      this.now.getTime() + timers.pickMs + timers.latencyAllowanceCapMs,
    );
  }

  /**
   * Öffnet die Frage des Schritts. Ist kein Mensch gefragt, bleibt sie offen, bis die Bedenkzeit
   * der gefragten Bots um ist (O-43): Wer zuschaut, liest so lange mit, und die Bots gelten in der
   * Ansicht nach derselben Zeit als fertig. `RESOLVE_NOW` gibt es nur noch, wenn kein Mensch mehr
   * zur Partie gehört und also niemand zuschaut.
   */
  protected async openQuestion(): Promise<'WAITING' | 'RESOLVE_NOW' | 'ABANDONED'> {
    const pending = this.pendingQuestion();
    if (!pending) throw new Error('Schritt ohne Frage');
    const kind: QuestionKind = pending.type;
    const seq = (this.match.questionSeq ?? 0) + 1;
    const versionId = await this.chooseQuestion(kind, seq, pending.category);
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
        purpose: pending.purpose,
        seats: [...pending.seats],
        presentation: JSON.stringify(newPresentation(content)),
        time_limit_ms: timeLimitMs,
        opened_at: this.now,
        closes_at: closesAt,
      })
      .execute();
    // Bot-Antworten vor jeder Präsentation erzeugen und speichern (versiegelt, NPC_SYSTEM §3.4)
    let botsDoneMs = 0;
    for (const seat of pending.seats) {
      const player = this.playerAt(seat);
      if (player.botStrength !== null) {
        const profile = this.botProfile(seat, player.botStrength);
        const thinkMs = await this.insertBotAnswer(
          seq,
          seat,
          player.botStrength,
          profile,
          content,
          timeLimitMs,
        );
        botsDoneMs = Math.max(botsDoneMs, thinkMs);
      }
    }
    this.match.questionSeq = seq;
    this.match.phase = 'QUESTION';
    this.match.phaseDeadlineAt = new Date(closesAt.getTime() + RESOLVE_GRACE_MS);
    this.emit('QUESTION_OPENED', {
      seq,
      kind,
      purpose: pending.purpose,
      seats: [...pending.seats],
      timeLimitMs,
      closesAt: closesAt.toISOString(),
      ...(pending.category === null ? {} : { category: pending.category }),
    });
    const humans = pending.seats.filter((seat) => this.playerAt(seat).userId !== null);
    if (humans.length > 0) return 'WAITING';
    if (this.humanUserIds().length === 0) return 'RESOLVE_NOW';
    // Nur Bots gefragt: Die Frage endet, sobald der letzte von ihnen fertig ist
    this.match.phaseDeadlineAt = new Date(this.now.getTime() + Math.min(botsDoneMs, timeLimitMs));
    return 'WAITING';
  }

  /**
   * Fragen einer Art, die gestellt werden können, und die in dieser Partie schon gestellten (alle
   * Arten, neueste zuerst). Gesehen zählt für alle Menschen der Partie.
   */
  private async questionPool(kind: QuestionKind): Promise<{
    readonly candidates: readonly QuestionCandidate[];
    readonly used: readonly { readonly question_id: string; readonly category: string }[];
  }> {
    const candidates = await loadCandidates(this.tx, {
      kind,
      userIds: this.humanUserIds(),
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
    return { candidates, used };
  }

  /** Kategorien, in denen es noch eine in dieser Partie ungestellte Frage der Art gibt. */
  protected async freshCategories(kind: QuestionKind): Promise<ReadonlySet<string>> {
    const { candidates, used } = await this.questionPool(kind);
    const usedIds = new Set(used.map((u) => u.question_id));
    return new Set(candidates.filter((c) => !usedIds.has(c.questionId)).map((c) => c.category));
  }

  /**
   * Frage aus dem Bestand (QUIZ_ENGINE §5, Strom `question-pick` je Frage): keine, die in dieser
   * Partie schon kam, solange es andere gibt. Mit `category` (Glücksrad) zuerst aus dieser
   * Kategorie; hat sie keine ungestellte Frage mehr, eine ungestellte aus einer anderen, erst dann
   * eine Wiederholung (MATCH_RULES §11.6).
   */
  private async chooseQuestion(
    kind: QuestionKind,
    seq: number,
    category: QuestionCategory | null,
  ): Promise<string | null> {
    const { candidates, used } = await this.questionPool(kind);
    const usedIds = new Set(used.map((u) => u.question_id));
    const fresh = candidates.filter((c) => !usedIds.has(c.questionId));
    const inCategory = (list: readonly QuestionCandidate[]) =>
      category === null ? list : list.filter((c) => c.category === category);
    const pool =
      [inCategory(fresh), fresh, inCategory(candidates)].find((list) => list.length > 0) ??
      candidates;
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

  /** Erzeugt die Antwort eines Bots und liefert, nach welcher Zeit er als fertig gilt. */
  private async insertBotAnswer(
    seq: number,
    seat: number,
    strength: MatchBotStrength,
    profile: NpcProfile,
    content: QuestionContent,
    timeLimitMs: number,
  ): Promise<number> {
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
      return botThinkMs(this.match.id, seq, seat, timeLimitMs);
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
    return answer.estimateMs;
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

    this.applyAnswers({
      seats: question.seats,
      correct: (seat) => counted(seat)?.is_correct === true,
      estimate: estimateOf,
    });
    this.match.phase = 'REVEAL';
    this.match.phaseDeadlineAt = new Date(this.now.getTime() + this.rules.timers.revealMs);
  }

  /**
   * Arbeitet fällige Fristen ab: Wahl nach Zeitablauf, Auflösung einer Frage, Ende der Anzeige,
   * Ende der Rüstzeit. Liefert `true`, wenn sich etwas geändert hat.
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
          const seat = this.chooser();
          if (seat === null) throw new Error('Wahl ohne Wählenden');
          const { rng, entityId } = await this.drawRng('auto');
          const region = this.autoPick(rng);
          this.emit('AUTO_PICKED', {
            seat,
            region,
            rng: { purpose: 'match', entityId, keyId: this.ctx.rngKeyId, version: RNG_VERSION },
          });
          this.applyPick(seat, region);
          await this.enterStep(seat);
          break;
        }
        case 'PREPARE':
          await this.closePrepare();
          break;
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
    if (seat === null || this.chooser() !== seat) {
      throw new ApiError(409, 'NOT_YOUR_TURN', 'Ein anderer Sitz ist dran');
    }
    this.applyPick(seat, region);
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

  /** Abrechnung: Die Zustandsmaschine ist am Ende, die Partie wird beendet. */
  protected async finish(): Promise<void> {
    this.match.status = 'FINISHED';
    this.match.phase = null;
    this.match.phaseDeadlineAt = null;
    this.match.finishedAt = this.now;
    // Testpartien zählen nicht (ADR-048), Partien mit Bots auch nicht (ADR-052) [E]
    if (this.match.kind !== 'STANDARD' || this.players.some((p) => p.userId === null)) return;
    const winners = this.winnerSeats();
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

/** Inhalt eines Ereignisses der Zustandsmaschine ohne seine Art (die wird der Ereignistyp). */
export function eventPayload(event: { readonly kind: string }): Record<string, unknown> {
  return Object.fromEntries(Object.entries(event).filter(([key]) => key !== 'kind'));
}

/** Neue Partie-ID (UUIDv7). */
export function newMatchId(): string {
  return newId();
}
