import {
  INVITE_CODE_PATTERN,
  MATCH_BOT_STRENGTH_CODES,
  type MatchBotStrengthCode,
  type MatchCreateRequest,
  type MatchListResponse,
} from '@rdw/protocol';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ActionKey, ApiRequestError, api } from '../api/client.ts';
import { Icon } from '../art/Icons.tsx';
import { Swords } from '../art/Swords.tsx';
import { ErrorNote } from '../components/ErrorNote.tsx';
import { formatTime, t } from '../i18n/i18n.ts';
import { navigate } from '../router.ts';

/**
 * Einstieg in die Partie (MATCH_RULES §3): offene Partie fortsetzen, neue Partie eröffnen, mit
 * Code beitreten oder, außer in Produktion, eine Testpartie gegen Bots eröffnen (ADR-048).
 * Jedes Konto ist höchstens in einer offenen Partie.
 */

type Summary = MatchListResponse['matches'][number];

function isOpen(match: Summary): boolean {
  return match.status === 'LOBBY' || match.status === 'RUNNING';
}

export function MatchesScreen() {
  const [list, setList] = useState<MatchListResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [shortTimers, setShortTimers] = useState(false);
  const [testShortTimers, setTestShortTimers] = useState(false);
  const [code, setCode] = useState('');
  const [testSeats, setTestSeats] = useState<2 | 3>(3);
  const [bots, setBots] = useState<MatchBotStrengthCode[]>(['MEDIUM', 'MEDIUM']);
  const createKey = useRef(new ActionKey());
  const joinKey = useRef(new ActionKey());

  const load = useCallback(async () => {
    try {
      setList(await api.matches());
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(key: ActionKey, payload: unknown, call: (key: string) => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      let matchId: string;
      try {
        matchId = await call(key.for(payload));
        key.settle();
      } catch (e) {
        key.settle(e);
        throw e;
      }
      navigate({ name: 'match', matchId });
    } catch (e) {
      setError(e);
      // Schon in einer Partie: die Liste zeigt sie zum Fortsetzen
      if (e instanceof ApiRequestError && e.code === 'ALREADY_IN_MATCH') void load();
    } finally {
      setBusy(false);
    }
  }

  function create(body: MatchCreateRequest) {
    void act(createKey.current, body, async (key) => (await api.createMatch(body, key)).matchId);
  }

  function join(event: FormEvent) {
    event.preventDefault();
    const inviteCode = code.trim().toUpperCase();
    void act(
      joinKey.current,
      inviteCode,
      async (key) => (await api.joinMatch(inviteCode, key)).matchId,
    );
  }

  const open = list?.matches.find(isOpen) ?? null;
  const recent = list?.matches.filter((m) => !isOpen(m)) ?? [];
  const codeValid = INVITE_CODE_PATTERN.test(code.trim().toUpperCase());

  return (
    <main className="page page-wide hub" data-testid="matches-screen">
      <header className="hub-head">
        <Swords size={46} />
        <div>
          <h1>{t('match.hub.title')}</h1>
          <p className="muted">{t('match.startText')}</p>
        </div>
      </header>
      {error ? <ErrorNote error={error} /> : null}
      {list === null && !error ? <p>{t('app.loading')}</p> : null}

      {open ? (
        <section className="card card-accent stack" aria-labelledby="open-title">
          <h2 id="open-title">{t('match.hub.openTitle')}</h2>
          <div className="world-row">
            <span>
              {t('match.hub.openItem', {
                kind: t(`match.kind.${open.kind}`),
                time: formatTime(open.createdAt),
                status: t(`match.status.${open.status}`),
              })}
            </span>
            <button
              type="button"
              className="button button-primary"
              onClick={() => navigate({ name: 'match', matchId: open.id })}
            >
              {t('match.hub.open')}
            </button>
          </div>
        </section>
      ) : null}

      {list && !open ? (
        <>
          <div className="hub-grid">
            <section className="card stack" aria-labelledby="new-title">
              <h2 id="new-title" className="icon-title">
                <Icon kind="banner" />
                {t('match.hub.newTitle')}
              </h2>
              <p className="muted">{t('match.hub.newText')}</p>
              <label className="check">
                <input
                  type="checkbox"
                  checked={shortTimers}
                  onChange={(e) => setShortTimers(e.target.checked)}
                />
                {t('match.hub.shortTimers')}
              </label>
              <button
                type="button"
                className="button button-primary"
                disabled={busy}
                onClick={() =>
                  create({ kind: 'STANDARD', rules: shortTimers ? 'PLAYTEST' : 'DEFAULT' })
                }
              >
                {t('match.hub.create')}
              </button>
            </section>

            <section className="card stack" aria-labelledby="join-title">
              <h2 id="join-title" className="icon-title">
                <Icon kind="key" />
                {t('match.hub.joinTitle')}
              </h2>
              <form className="form" onSubmit={join}>
                <div className="field">
                  <label htmlFor="invite-code">{t('match.hub.codeLabel')}</label>
                  <input
                    id="invite-code"
                    className="code-input"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    maxLength={8}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                  <span className="field-hint">{t('match.hub.codeHint')}</span>
                </div>
                <button type="submit" className="button" disabled={busy || !codeValid}>
                  {t('match.hub.join')}
                </button>
              </form>
            </section>
          </div>

          {list.testMatchesEnabled ? (
            <section className="card stack" aria-labelledby="test-title" data-testid="test-match">
              <h2 id="test-title" className="icon-title">
                <Icon kind="target" />
                {t('match.hub.testTitle')}
              </h2>
              <p className="muted">{t('match.hub.testText')}</p>
              <fieldset className="choices">
                <legend>{t('match.hub.seatsLegend')}</legend>
                {([2, 3] as const).map((n) => (
                  <label key={n} className="check">
                    <input
                      type="radio"
                      name="test-seats"
                      checked={testSeats === n}
                      onChange={() => setTestSeats(n)}
                    />
                    {n === 2 ? t('match.hub.seats2') : t('match.hub.seats3')}
                  </label>
                ))}
              </fieldset>
              {bots.slice(0, testSeats - 1).map((strength, i) => (
                <div className="field" key={i}>
                  <label htmlFor={`bot-${i}`}>{t('match.hub.botLabel', { n: i + 1 })}</label>
                  <select
                    id={`bot-${i}`}
                    value={strength}
                    onChange={(e) =>
                      setBots((current) =>
                        current.map((s, j) =>
                          j === i ? (e.target.value as MatchBotStrengthCode) : s,
                        ),
                      )
                    }
                  >
                    {MATCH_BOT_STRENGTH_CODES.map((level) => (
                      <option key={level} value={level}>
                        {t(`match.bot.${level}`)}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <label className="check">
                <input
                  type="checkbox"
                  checked={testShortTimers}
                  onChange={(e) => setTestShortTimers(e.target.checked)}
                />
                {t('match.hub.shortTimers')}
              </label>
              <button
                type="button"
                className="button button-primary"
                disabled={busy}
                onClick={() =>
                  create({
                    kind: 'TEST',
                    rules: testShortTimers ? 'PLAYTEST' : 'DEFAULT',
                    seats: testSeats,
                    botStrengths: bots.slice(0, testSeats - 1),
                  })
                }
              >
                {t('match.hub.createTest')}
              </button>
            </section>
          ) : null}
        </>
      ) : null}

      {recent.length > 0 ? (
        <section className="card stack" aria-labelledby="recent-title">
          <h2 id="recent-title" className="icon-title">
            <Icon kind="scroll" />
            {t('match.hub.recentTitle')}
          </h2>
          <ul className="world-list">
            {recent.map((m) => (
              <li key={m.id} className="world-row">
                <span>
                  {t('match.hub.openItem', {
                    kind: t(`match.kind.${m.kind}`),
                    time: formatTime(m.createdAt),
                    status: t(`match.status.${m.status}`),
                  })}
                </span>
                <button
                  type="button"
                  className="button"
                  onClick={() => navigate({ name: 'match', matchId: m.id })}
                >
                  {t('match.hub.open')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <nav className="page-nav" aria-label={t('nav.label')}>
        <button type="button" className="link" onClick={() => navigate({ name: 'start' })}>
          {t('match.hub.back')}
        </button>
      </nav>
    </main>
  );
}
