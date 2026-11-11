import { t } from '../i18n/i18n.ts';

/**
 * Hinweis im Hochformat (ADR-059): Die Partie spielt auf der ganzen Karte und braucht am Handy das
 * Querformat. Eine Webseite kann das Drehen nicht erzwingen, also bittet sie darum. Zu sehen ist
 * der Hinweis nur auf einem hochkant gehaltenen Handy (`stage.css`).
 */
export function RotateHint() {
  return (
    <div className="rotate-hint" role="alert">
      <section className="sheet">
        <svg className="rotate-art" viewBox="-60 -60 120 120" aria-hidden="true" focusable="false">
          <rect x="-20" y="-40" width="40" height="80" rx="7" className="phone phone-from" />
          <rect x="-40" y="-20" width="80" height="40" rx="7" className="phone" />
          <path d="M-44-34C-30-54 6-58 28-44" className="rotate-arrow" />
          <path d="M30-56L30-42L16-44" className="rotate-arrow" />
        </svg>
        <h2>{t('match.stage.rotateTitle')}</h2>
        <p>{t('match.stage.rotateText')}</p>
        <p className="rotate-lock">{t('match.stage.rotateLock')}</p>
      </section>
    </div>
  );
}
