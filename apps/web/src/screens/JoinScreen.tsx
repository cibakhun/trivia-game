import { INVITE_CODE_PATTERN } from '@rdw/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionKey, ApiRequestError, api } from '../api/client.ts';
import { Swords } from '../art/Swords.tsx';
import { LoginForm } from '../components/AccountForms.tsx';
import { ClientError, ErrorNote } from '../components/ErrorNote.tsx';
import { t } from '../i18n/i18n.ts';
import { navigate } from '../router.ts';
import { useSession } from '../session.tsx';

/**
 * Einladungslink `/partie/beitreten/<Code>` (ADR-052): Wer ihn öffnet und in diesem Browser schon
 * ein Konto hat, tritt der Aufstellung ohne weiteren Schritt bei und landet dort. Ohne Konto
 * genügt ein Tipp auf „Als Gast beitreten“. Von selbst entsteht kein Konto (O-23): Chat-Programme
 * öffnen Links für ihre Vorschau, und so ein Aufruf soll weder ein Gastkonto anlegen noch einen
 * Platz belegen.
 */
export function JoinScreen({ code }: { readonly code: string }) {
  const { state, startGuest, reload, switching } = useSession();
  const [error, setError] = useState<unknown>(null);
  const [guestBusy, setGuestBusy] = useState(false);
  const key = useRef(new ActionKey());
  const tried = useRef(false);
  const valid = INVITE_CODE_PATTERN.test(code);
  const ready = state.status === 'ready';

  const join = useCallback(async () => {
    setError(null);
    const action = key.current;
    try {
      const { matchId } = await api.joinMatch(code, action.for(code));
      action.settle();
      // Ersetzen statt anhängen: „Zurück“ soll nicht noch einmal beitreten
      navigate({ name: 'match', matchId }, { replace: true });
    } catch (e) {
      action.settle(e);
      setError(e);
    }
  }, [code]);

  // Mit Sitzung sofort beitreten, genau einmal; ein Fehler bleibt stehen, bis jemand neu versucht
  useEffect(() => {
    if (!ready || !valid || tried.current) return;
    tried.current = true;
    void join();
  }, [ready, valid, join]);

  async function guest() {
    setGuestBusy(true);
    setError(null);
    try {
      await startGuest(); // danach ist die Sitzung da, und der Beitritt oben läuft von selbst
    } catch (e) {
      setError(e);
    } finally {
      setGuestBusy(false);
    }
  }

  const otherMatch =
    error instanceof ApiRequestError &&
    error.code === 'ALREADY_IN_MATCH' &&
    typeof error.details.matchId === 'string'
      ? error.details.matchId
      : null;

  return (
    <main className="page hub" data-testid="join-screen">
      <header className="hub-head">
        <Swords size={46} />
        <div>
          <h1>{t('match.join.title')}</h1>
          <p className="muted">{t('match.join.text')}</p>
        </div>
      </header>

      {valid ? (
        <div className="invite">
          <span className="muted">{t('match.lobby.code')}</span>
          <strong className="invite-code" data-testid="invite-code">
            {code.split('').map((letter, i) => (
              <span key={i} className="invite-tile">
                {letter}
              </span>
            ))}
          </strong>
        </div>
      ) : (
        <ErrorNote error={new ClientError('match.join.invalid')} />
      )}

      {state.status === 'loading' ? <p>{t('app.loading')}</p> : null}
      {state.status === 'error' ? (
        <ErrorNote error={state.error} onRetry={() => void reload()} />
      ) : null}

      {valid && state.status === 'anonymous' ? (
        <>
          <section className="card stack">
            <button
              type="button"
              className="button button-primary button-wide"
              disabled={guestBusy || switching}
              onClick={() => void guest()}
            >
              {t('match.join.guest')}
            </button>
            <p className="muted">{t('start.guestHint')}</p>
            {error ? <ErrorNote error={error} /> : null}
          </section>
          <section className="card" aria-labelledby="join-login-title">
            <h2 id="join-login-title">{t('start.haveAccount')}</h2>
            <p className="muted">{t('match.join.loginHint')}</p>
            <LoginForm />
          </section>
        </>
      ) : null}

      {valid && ready && !error ? <p aria-live="polite">{t('match.join.joining')}</p> : null}
      {valid && ready && error ? (
        <section className="card stack">
          {otherMatch ? (
            <>
              <ErrorNote error={error} />
              <button
                type="button"
                className="button button-primary"
                onClick={() => navigate({ name: 'match', matchId: otherMatch })}
              >
                {t('match.join.toOpen')}
              </button>
            </>
          ) : (
            <ErrorNote error={error} onRetry={() => void join()} />
          )}
        </section>
      ) : null}

      <nav className="page-nav" aria-label={t('nav.label')}>
        <button
          type="button"
          className="link"
          onClick={() => navigate({ name: ready ? 'matches' : 'start' })}
        >
          {ready ? t('match.join.toHub') : t('match.hub.back')}
        </button>
      </nav>
    </main>
  );
}
