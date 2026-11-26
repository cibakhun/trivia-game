import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../api/client.ts';
import { Icon } from '../art/Icons.tsx';
import { MenuMap } from '../art/MenuMap.tsx';
import { ErrorNote } from '../components/ErrorNote.tsx';
import { t } from '../i18n/i18n.ts';
import { SheetFrame } from '../menu/MenuSheets.tsx';
import { navigate } from '../router.ts';
import { useSession } from '../session.tsx';
import '../match/stage.css';
import '../menu/menu.css';
import '../menu/account.css';

type Outcome =
  | { readonly status: 'checking' }
  | { readonly status: 'done'; readonly email: string }
  | { readonly status: 'failed'; readonly error: unknown };

/**
 * Link aus der Bestätigungsmail `/email/bestaetigen/<Token>` (ADR-086): bestätigt die Adresse
 * sofort, auch ohne Sitzung in diesem Browser (etwa am Handy, wenn man am PC spielt). Über der
 * Karte des Hauptmenüs steht das Ergebnis; danach geht es zum Spiel oder zur Kontoseite.
 */
export function VerifyEmailScreen({ token }: { readonly token: string }) {
  const { state, reload } = useSession();
  const [outcome, setOutcome] = useState<Outcome>({ status: 'checking' });
  const started = useRef(false);

  // Maßeinheit der Bühne wie im Hauptmenü
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.add('match-playing');
    return () => root.classList.remove('match-playing');
  }, []);

  useEffect(() => {
    // Strenger Modus ruft Effekte doppelt auf; der Link gilt ohnehin auch ein zweites Mal
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const result = await api.verifyEmail(token);
        setOutcome({ status: 'done', email: result.email });
        // Plakette und Kontoseite zeigen sofort „bestätigt“
        void reload();
      } catch (error) {
        setOutcome({ status: 'failed', error });
      }
    })();
  }, [token, reload]);

  const signedIn = state.status === 'ready' && !state.me.user.isGuest;

  return (
    <main className="stage menu with-sheet" data-testid="email-verify">
      <div className="stage-map">
        <MenuMap cover />
      </div>
      <div className="stage-veil on" aria-hidden="true" />
      <div className="menu-centre">
        <SheetFrame title={t('konto.verify.title')} className="email-verify">
          {outcome.status === 'checking' ? (
            <p className="menu-note" role="status">
              {t('konto.verify.checking')}
            </p>
          ) : outcome.status === 'done' ? (
            <div className="acct-callout acct-email-status done" role="status">
              <span className="acct-callout-icon" aria-hidden="true">
                <Icon kind="shield" size={22} />
              </span>
              <span className="acct-callout-text">
                <b>{t('konto.verify.doneTitle')}</b>
                <span>{t('konto.verify.doneText', { email: outcome.email })}</span>
              </span>
            </div>
          ) : (
            <>
              <p className="email-verify-failed">
                <b>{t('konto.verify.failedTitle')}</b>
              </p>
              <ErrorNote error={outcome.error} />
            </>
          )}
          <div className="acct-form-foot email-verify-foot">
            {signedIn ? (
              <button
                type="button"
                className="button"
                onClick={() => navigate({ name: 'account', view: null }, { replace: true })}
              >
                {t('konto.verify.toAccount')}
              </button>
            ) : null}
            <button
              type="button"
              className="button button-primary menu-go"
              disabled={outcome.status === 'checking'}
              onClick={() => navigate({ name: 'start' }, { replace: true })}
            >
              {t('konto.verify.toGame')}
            </button>
          </div>
        </SheetFrame>
      </div>
    </main>
  );
}
