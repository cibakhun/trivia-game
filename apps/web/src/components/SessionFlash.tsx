import { useEffect } from 'react';
import { Icon } from '../art/Icons.tsx';
import { t } from '../i18n/i18n.ts';
import { dateText } from '../menu/account-text.ts';
import { useSession, type SessionFlash } from '../session.tsx';
import './session-flash.css';

/**
 * Nachricht nach einem Kontowechsel über jedem Bildschirm (ADR-086): Löschantrag gestellt (bleibt,
 * bis man sie schließt, denn sie sagt, wie man das Konto noch behält) oder mit der Anmeldung
 * aufgehoben (verschwindet nach acht Sekunden).
 */
export function SessionFlashNote() {
  const { flash, dismissFlash } = useSession();
  useEffect(() => {
    if (flash?.kind !== 'deletionCancelled') return;
    const id = window.setTimeout(dismissFlash, 8000);
    return () => window.clearTimeout(id);
  }, [flash, dismissFlash]);
  if (!flash) return null;
  return (
    <div className={`session-flash ${flash.kind}`} role="status" data-testid="session-flash">
      <Icon kind={flash.kind === 'deletionCancelled' ? 'shield' : 'door'} size={20} />
      <p>{flashText(flash)}</p>
      <button
        type="button"
        className="session-flash-close"
        aria-label={t('konto.flash.close')}
        onClick={dismissFlash}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

export function flashText(flash: SessionFlash): string {
  if (flash.kind === 'deletionCancelled') return t('konto.flash.deletionCancelled');
  return flash.deletesAt === null
    ? t('konto.flash.deleted')
    : t('konto.flash.deletionRequested', { date: dateText(flash.deletesAt, true) });
}
