import { ApiRequestError, NetworkError } from '../api/client.ts';
import { errorMessage, t } from '../i18n/i18n.ts';

/** Lesbarer Text zu einem Fehler aus der Schnittstelle. */
export function describeError(error: unknown): string {
  if (error instanceof ApiRequestError) return errorMessage(error.code, error.details);
  if (error instanceof NetworkError) return t('errors.network');
  return t('errors.generic');
}

export function ErrorNote({
  error,
  onRetry,
}: {
  readonly error: unknown;
  readonly onRetry?: () => void;
}) {
  return (
    <div className="note note-error" role="alert">
      <p>{describeError(error)}</p>
      {onRetry ? (
        <button type="button" className="button" onClick={onRetry}>
          {t('app.retry')}
        </button>
      ) : null}
    </div>
  );
}
