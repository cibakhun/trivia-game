import { useEffect, useState } from 'react';
import { LoginForm } from '../components/AccountForms.tsx';
import { ErrorNote } from '../components/ErrorNote.tsx';
import { WorldList } from '../components/WorldList.tsx';
import { t } from '../i18n/i18n.ts';
import { navigate } from '../router.ts';
import { useSession } from '../session.tsx';

/**
 * Start: als Gast spielen oder anmelden, dann Welt wählen und beitreten. Wer schon ein Reich hat,
 * kommt direkt zur Karte; andere Welten erreicht er über „Welten“.
 */
export function StartScreen() {
  const { state, startGuest, reload, switching } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const me = state.status === 'ready' ? state.me : null;
  // Auch ein gefallenes Reich führt zur Karte (dort steht der Hinweis); erneut beitreten geht nicht
  const playing = me?.instances.find((i) => i.kingdom !== null) ?? null;

  useEffect(() => {
    if (playing) navigate({ name: 'play', instanceId: playing.instanceId }, { replace: true });
  }, [playing]);

  async function guest() {
    setBusy(true);
    setError(null);
    try {
      await startGuest();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="start">
      <h1>{t('app.title')}</h1>
      <p className="tagline">{t('start.tagline')}</p>
      {state.status === 'loading' ? <p>{t('app.loading')}</p> : null}
      {state.status === 'error' ? (
        <ErrorNote error={state.error} onRetry={() => void reload()} />
      ) : null}
      {state.status === 'anonymous' ? (
        <>
          <section className="card">
            <button
              type="button"
              className="button button-primary"
              disabled={busy || switching}
              onClick={() => void guest()}
            >
              {t('start.guest')}
            </button>
            <p className="muted">{t('start.guestHint')}</p>
            {error ? <ErrorNote error={error} /> : null}
          </section>
          <section className="card" aria-labelledby="login-title">
            <h2 id="login-title">{t('start.haveAccount')}</h2>
            <LoginForm />
          </section>
        </>
      ) : null}
      {me && !playing ? (
        <>
          <WorldList />
          <nav className="page-nav" aria-label={t('nav.label')}>
            <button type="button" className="link" onClick={() => navigate({ name: 'account' })}>
              {me.user.isGuest ? t('nav.secureAccount') : t('nav.account')}
            </button>
          </nav>
        </>
      ) : null}
    </main>
  );
}
