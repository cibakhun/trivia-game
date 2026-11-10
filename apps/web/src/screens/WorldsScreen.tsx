import { ErrorNote } from '../components/ErrorNote.tsx';
import { WorldList } from '../components/WorldList.tsx';
import { t } from '../i18n/i18n.ts';
import { navigate } from '../router.ts';
import { useSession } from '../session.tsx';

/** Weltwahl ohne automatische Weiterleitung: weiterspielen oder einer weiteren Welt beitreten. */
export function WorldsScreen() {
  const { state, reload } = useSession();
  if (state.status === 'error') {
    return (
      <main className="page">
        <ErrorNote error={state.error} onRetry={() => void reload()} />
      </main>
    );
  }
  if (state.status !== 'ready') return <p className="centre">{t('app.loading')}</p>;
  return (
    <main className="page">
      <nav className="page-nav" aria-label={t('nav.label')}>
        <button type="button" className="link" onClick={() => navigate({ name: 'start' })}>
          ← {t('nav.back')}
        </button>
        <button type="button" className="link" onClick={() => navigate({ name: 'account' })}>
          {state.me.user.isGuest ? t('nav.secureAccount') : t('nav.account')}
        </button>
      </nav>
      <h1>{t('worlds.title')}</h1>
      <WorldList />
    </main>
  );
}
