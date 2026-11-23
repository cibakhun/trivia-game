import {
  normalizeUsername,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  usernameProblem,
  type NameCheckStatus,
  type UsernameProblem,
} from '@rdw/protocol';
import { useCallback, useEffect, useId, useRef, useState, type Ref } from 'react';
import { api } from '../api/client.ts';
import { Icon } from '../art/Icons.tsx';
import { t, type MessageKey } from '../i18n/i18n.ts';

/**
 * Eigener Benutzername (ADR-082): ein Eingabefeld, das beim Tippen sagt, ob der Name den Regeln
 * folgt und ob er frei ist, dazu Ideen aus Bausteinen zum Antippen. Der Server bleibt maßgeblich;
 * die Prüfung hier spart nur den Umweg über ein gescheitertes Absenden.
 */

/** Wartezeit nach dem letzten Tastendruck, bevor der Server gefragt wird. */
const CHECK_DELAY_MS = 300;
/** So viele Ideen stehen unter dem Feld. */
const IDEA_COUNT = 3;

export interface NameCheckState {
  /** Vereinheitlichte Form des Getippten (so wird er gespeichert). */
  readonly name: string;
  /** Regelverstoß, ohne Server geprüft; `SHORT` auch für ein leeres Feld. */
  readonly problem: UsernameProblem | null;
  /** Antwort des Servers für genau diesen Namen; `null`, solange sie fehlt. */
  readonly status: NameCheckStatus | null;
  readonly checking: boolean;
  /** Merkt sich ein Ergebnis, das anders bekannt wurde (Ideen, Fehler beim Absenden). */
  readonly remember: (name: string, status: NameCheckStatus) => void;
}

/** Prüft den getippten Namen: erst die Regeln, dann (verzögert) beim Server. */
export function useNameCheck(raw: string): NameCheckState {
  const name = normalizeUsername(raw);
  const problem = usernameProblem(name);
  const [known, setKnown] = useState<ReadonlyMap<string, NameCheckStatus>>(() => new Map());
  // Name, für den die Frage scheiterte (kein Netz): dann bleibt es beim Hinweis
  const [failed, setFailed] = useState<string | null>(null);
  const cached = known.get(name);

  const remember = useCallback((key: string, status: NameCheckStatus) => {
    setKnown((previous) => new Map(previous).set(key, status));
  }, []);
  // Die Antwort der Prüfung kann älter sein als ein Ergebnis, das inzwischen anders bekannt wurde
  // (etwa „vergeben“ beim Absenden): Dann überschreibt sie es nicht.
  const learn = useCallback((key: string, status: NameCheckStatus) => {
    setKnown((previous) => (previous.has(key) ? previous : new Map(previous).set(key, status)));
  }, []);

  useEffect(() => {
    if (problem !== null || cached !== undefined) return;
    let cancelled = false;
    const id = window.setTimeout(() => {
      api.checkName(name).then(
        (result) => learn(result.name, result.status),
        () => {
          // Ohne Antwort bleibt es beim Hinweis; beim Absenden entscheidet der Server
          if (!cancelled) setFailed(name);
        },
      );
    }, CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [name, problem, cached, learn]);

  return {
    name,
    problem,
    status: problem === null ? (cached ?? null) : null,
    // Auch die Wartezeit vor der Frage zählt: Sonst stünde kurz der Hinweis statt „wird geprüft“
    checking: problem === null && cached === undefined && failed !== name,
    remember,
  };
}

/** Darf der Name so abgeschickt werden? Offene Prüfungen hindern nicht (der Server prüft). */
export function nameUsable(check: NameCheckState): boolean {
  return check.problem === null && check.status !== 'TAKEN' && check.status !== 'BLOCKED';
}

const PROBLEM_TEXT: Record<UsernameProblem, MessageKey> = {
  SHORT: 'names.problem.short',
  LONG: 'names.problem.long',
  CHARS: 'names.problem.chars',
  EDGE: 'names.problem.edge',
  DOUBLE: 'names.problem.double',
  NO_LETTER: 'names.problem.noLetter',
};

type Tone = 'hint' | 'wait' | 'ok' | 'bad';

/** Zeile unter dem Feld: Hinweis, Regelverstoß, Prüfung läuft, frei, vergeben. */
function verdict(check: NameCheckState, showAll: boolean): { tone: Tone; text: string } {
  const hint = {
    tone: 'hint' as const,
    text: t('names.rules', { min: USERNAME_MIN_LENGTH, max: USERNAME_MAX_LENGTH }),
  };
  if (check.name === '') return showAll ? { tone: 'bad', text: t('account.required') } : hint;
  if (check.problem !== null) {
    // Zu kurz oder mit Trennzeichen am Ende: beim Tippen normal, erst nach dem Verlassen ein Fehler
    const early = check.problem === 'SHORT' || check.problem === 'EDGE';
    if (early && !showAll) return hint;
    return {
      tone: 'bad',
      text: t(PROBLEM_TEXT[check.problem], { min: USERNAME_MIN_LENGTH, max: USERNAME_MAX_LENGTH }),
    };
  }
  switch (check.status) {
    case 'FREE':
      return { tone: 'ok', text: t('names.status.free') };
    case 'MINE':
      return { tone: 'hint', text: t('names.status.mine') };
    case 'TAKEN':
      return { tone: 'bad', text: t('names.status.taken') };
    case 'BLOCKED':
      return { tone: 'bad', text: t('names.status.blocked') };
    case 'INVALID':
      return { tone: 'bad', text: t('names.problem.chars') };
    case null:
      return check.checking ? { tone: 'wait', text: t('names.status.checking') } : hint;
  }
}

/** Ideen aus Bausteinen, die der Server als frei meldet; „Andere“ zieht neu. */
function NameIdeas({
  chosen,
  onPick,
  remember,
}: {
  /** Der Name im Feld: Ist er eine der Ideen, ist sie hervorgehoben. */
  readonly chosen: string;
  readonly onPick: (name: string) => void;
  readonly remember: NameCheckState['remember'];
}) {
  const [ideas, setIdeas] = useState<readonly string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [batch, setBatch] = useState(0);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const current = ++latest.current;
    setLoading(true);
    try {
      const { suggestions } = await api.playerNames();
      if (current !== latest.current) return;
      const names = suggestions.slice(0, IDEA_COUNT).map((s) => s.name);
      for (const name of names) remember(name, 'FREE');
      setIdeas(names);
      setBatch((n) => n + 1);
    } catch {
      // Ideen sind nur eine Hilfe: Ohne sie bleibt die Zeile leer
      if (current === latest.current) setIdeas((previous) => previous ?? []);
    } finally {
      if (current === latest.current) setLoading(false);
    }
  }, [remember]);

  useEffect(() => {
    void load();
    return () => {
      latest.current += 1;
    };
  }, [load]);

  if (ideas !== null && ideas.length === 0 && !loading) return null;
  return (
    <div className="name-ideas" aria-busy={loading} data-testid="name-ideas">
      <span className="name-ideas-label">{t('names.ideas')}</span>
      {(ideas ?? []).map((idea, i) => (
        <button
          key={`${idea}-${batch}`}
          type="button"
          className={`name-idea${idea === chosen ? ' on' : ''}`}
          style={{ ['--i' as string]: i }}
          aria-pressed={idea === chosen}
          onClick={() => onPick(idea)}
        >
          {idea}
        </button>
      ))}
      <button
        type="button"
        className="name-ideas-more"
        aria-label={t('names.more')}
        title={t('names.more')}
        disabled={loading}
        onClick={() => void load()}
      >
        <Icon kind="dice" size={18} />
      </button>
    </div>
  );
}

export function NameField({
  label,
  value,
  onChange,
  check,
  showAll,
  inputRef,
  ideas = true,
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly check: NameCheckState;
  /** Auch Fehler zeigen, die beim Tippen noch normal sind (nach Verlassen oder Absenden). */
  readonly showAll: boolean;
  readonly inputRef?: Ref<HTMLInputElement>;
  readonly ideas?: boolean;
  readonly testId?: string;
}) {
  const id = useId();
  const lineId = `${id}-line`;
  const line = verdict(check, showAll);
  return (
    <div className={`field name-field tone-${line.tone}`} data-testid={testId}>
      <label htmlFor={id}>{label}</label>
      <div className="name-input">
        <input
          id={id}
          ref={inputRef}
          value={value}
          autoComplete="username"
          autoCapitalize="words"
          autoCorrect="off"
          spellCheck={false}
          // Etwas Luft über der Grenze: Leerraum außen fällt beim Vereinheitlichen weg
          maxLength={USERNAME_MAX_LENGTH + 8}
          aria-invalid={line.tone === 'bad'}
          aria-describedby={lineId}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="name-mark" aria-hidden="true" data-tone={line.tone} />
      </div>
      <p id={lineId} className="name-line" aria-live="polite" data-testid="name-line">
        {line.text}
      </p>
      {ideas ? <NameIdeas chosen={check.name} onPick={onChange} remember={check.remember} /> : null}
    </div>
  );
}
