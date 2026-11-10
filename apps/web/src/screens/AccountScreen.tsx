import { useState } from 'react';
import {
  LoginForm,
  PasswordForm,
  PlayerNameForm,
  RegisterForm,
} from '../components/AccountForms.tsx';
import { ErrorNote } from '../components/ErrorNote.tsx';
import { t, type MessageKey } from '../i18n/i18n.ts';
import { navigate } from '../router.ts';
import { useSession } from '../session.tsx';

/**
 * Kontoseite (O-03): Gäste sichern hier ihr Konto oder melden sich mit einem anderen an;
 * gesicherte Konten ändern Spielername und Passwort. Abmelden warnt Gäste, weil ihr Reich danach
 * nicht mehr erreichbar ist.
 */
export function AccountScreen() {
  const { state, reload, logout } = useSession();
  const [notice, setNotice] = useState<MessageKey | null>(null);
  const [logoutError, setLogoutError] = useState<unknown>(null);
  const [leaving, setLeaving] = useState(false);

  if (state.status === 'error') {
    return (
      <main className="page">
        <ErrorNote error={state.error} onRetry={() => void reload()} />
      </main>
    );
  }
  if (state.status !== 'ready') return <p className="centre">{t('app.loading')}</p>;
  const { me } = state;
  const { profile } = me;

  async function signOut() {
    setLeaving(true);
    setLogoutError(null);
    try {
      await logout();
      navigate({ name: 'start' }, { replace: true });
    } catch (e) {
      setLogoutError(e);
      setLeaving(false);
    }
  }

  const done = (key: MessageKey) => () => setNotice(key);

  return (
    <main className="page">
      <nav className="page-nav" aria-label={t('nav.label')}>
        <button type="button" className="link" onClick={() => navigate({ name: 'start' })}>
          ← {t('nav.back')}
        </button>
        <button type="button" className="link" onClick={() => navigate({ name: 'worlds' })}>
          {t('nav.worlds')}
        </button>
      </nav>
      <h1>{t('account.title')}</h1>
      {notice ? (
        <p className="note note-success" role="status">
          {t(notice)}
        </p>
      ) : null}

      {me.user.isGuest ? (
        <>
          <section className="card card-accent" aria-labelledby="guest-title">
            <h2 id="guest-title">{t('account.guestTitle')}</h2>
            <p>{t('account.guestText')}</p>
          </section>
          <section className="card" aria-labelledby="register-title">
            <h2 id="register-title">{t('account.registerTitle')}</h2>
            <RegisterForm onDone={done('account.registered')} />
          </section>
          <section className="card" aria-labelledby="login-title">
            <h2 id="login-title">{t('account.loginTitle')}</h2>
            <LoginForm
              warning={t('account.loginGuestWarning')}
              onDone={() => navigate({ name: 'start' })}
            />
          </section>
        </>
      ) : (
        <>
          <section className="card" data-testid="account-summary">
            <p>{t('account.signedInAs', { username: me.user.username ?? '' })}</p>
            <p>
              {profile.displayName
                ? t('account.playerName', { name: profile.displayName })
                : t('account.noPlayerName')}
            </p>
          </section>
          <section className="card" aria-labelledby="name-title">
            <h2 id="name-title">{t('account.nameTitle')}</h2>
            <PlayerNameForm
              current={
                profile.playerName && profile.displayName
                  ? { parts: profile.playerName, name: profile.displayName }
                  : null
              }
              onDone={done('account.nameSaved')}
            />
          </section>
          <section className="card" aria-labelledby="password-title">
            <h2 id="password-title">{t('account.passwordTitle')}</h2>
            <PasswordForm onDone={done('account.passwordSaved')} />
          </section>
        </>
      )}

      <section className="card" aria-labelledby="logout-title">
        <h2 id="logout-title">{t('account.logoutTitle')}</h2>
        {me.user.isGuest ? <p className="note">{t('account.logoutGuestWarning')}</p> : null}
        <button
          type="button"
          className={me.user.isGuest ? 'button button-danger' : 'button'}
          disabled={leaving}
          onClick={() => void signOut()}
        >
          {me.user.isGuest ? t('account.logoutAnyway') : t('account.logout')}
        </button>
        {logoutError ? <ErrorNote error={logoutError} /> : null}
      </section>
    </main>
  );
}
