import { useState } from 'react';
import { Emblem } from '../art/Emblem.tsx';
import { HeroMap } from '../art/HeroMap.tsx';
import { LoginForm } from '../components/AccountForms.tsx';
import { ErrorNote } from '../components/ErrorNote.tsx';
import { WorldList } from '../components/WorldList.tsx';
import { t } from '../i18n/i18n.ts';
import { navigate } from '../router.ts';
import { useSession } from '../session.tsx';

/**
 * Start: als Gast spielen oder anmelden, dann die Partie (Hauptspiel, ADR-046) oder eine Welt
 * wählen. Wer in einer Welt schon ein Reich hat, findet es unter „Weiterspielen“; eine
 * automatische Weiterleitung zur Karte gibt es nicht mehr, damit die Partie erreichbar bleibt.
 */
export function StartScreen() {
  const { state, startGuest, reload, switching } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const me = state.status === 'ready' ? state.me : null;

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
      <header className="hero">
        <Emblem size={84} />
        <h1>{t('app.title')}</h1>
        <p className="tagline">{t('start.tagline')}</p>
      </header>
      <HeroMap />
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
      {me ? (
        <>
          <section className="card card-accent stack" aria-labelledby="match-title">
            <h2 id="match-title">{t('match.title')}</h2>
            <p>{t('match.startText')}</p>
            <button
              type="button"
              className="button button-primary"
              onClick={() => navigate({ name: 'matches' })}
            >
              {t('match.play')}
            </button>
          </section>
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
