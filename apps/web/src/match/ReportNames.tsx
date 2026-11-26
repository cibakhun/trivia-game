import type { MatchPlayer, MatchView } from '@rdw/protocol';
import { useEffect, useId, useRef, useState } from 'react';
import { ActionKey, ApiRequestError, api } from '../api/client.ts';
import { Icon } from '../art/Icons.tsx';
import { ClientError, ErrorNote } from '../components/ErrorNote.tsx';
import { t } from '../i18n/i18n.ts';
import './report.css';

/**
 * Namen melden (O-48, ADR-086): ein leiser Knopf in Aufstellung und Ergebnis, nur wenn es einen
 * meldbaren Mitspieler gibt (Mensch mit Namen, nicht man selbst). Er öffnet ein kleines Blatt: Name
 * wählen (bei nur einem steht er schon da), dann bestätigen. Die Spielleitung entscheidet später;
 * eine zweite Meldung desselben Namens ändert nichts.
 */
export function ReportNames({ view }: { readonly view: MatchView }) {
  const candidates = view.players.filter((p) => p.reportable);
  const [open, setOpen] = useState(false);
  if (candidates.length === 0) return null;
  return (
    <>
      <button
        type="button"
        className="report-open"
        onClick={() => setOpen(true)}
        data-testid="report-open"
      >
        <Icon kind="flag" size={14} />
        {t('match.report.open')}
      </button>
      {open ? (
        <ReportSheet
          matchId={view.match.id}
          candidates={candidates}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/** Gemeldete Plätze je Partie, solange die Seite offen ist: „gemeldet“ bleibt beim Wiederöffnen. */
const reportedSeats = new Map<string, Set<number>>();

function ReportSheet({
  matchId,
  candidates,
  onClose,
}: {
  readonly matchId: string;
  readonly candidates: readonly MatchPlayer[];
  readonly onClose: () => void;
}) {
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [reported, setReported] = useState<ReadonlySet<number>>(
    () => new Set(reportedSeats.get(matchId)),
  );
  const open = candidates.filter((p) => !reported.has(p.joinOrder));
  const [choice, setChoice] = useState<number | null>(() =>
    open.length === 1 ? (open[0]?.joinOrder ?? null) : null,
  );
  const [thanks, setThanks] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const key = useRef(new ActionKey());
  const chosen = candidates.find((p) => p.joinOrder === choice) ?? null;

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function report(player: MatchPlayer) {
    setBusy(true);
    setError(null);
    try {
      const result = await api.reportPlayerName(
        matchId,
        player.joinOrder,
        key.current.for(player.joinOrder),
      );
      key.current.settle();
      const next = new Set(reported).add(player.joinOrder);
      reportedSeats.set(matchId, next);
      setReported(next);
      setChoice(null);
      setThanks(result.name);
    } catch (e) {
      key.current.settle(e);
      setError(
        e instanceof ApiRequestError && e.code === 'RATE_LIMITED'
          ? new ClientError('match.report.limit')
          : e,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="report-layer"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="sheet report-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="report-sheet"
      >
        <header className="report-head">
          <Icon kind="flag" size={22} />
          <h3 id={titleId} ref={heading} tabIndex={-1}>
            {t('match.report.title')}
          </h3>
          <button
            type="button"
            className="report-close"
            aria-label={t('match.report.close')}
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <p className="report-lead">{t('match.report.lead')}</p>
        <ul className="report-names">
          {candidates.map((player) => {
            const done = reported.has(player.joinOrder);
            return (
              <li key={player.joinOrder}>
                <button
                  type="button"
                  className={`report-name${choice === player.joinOrder ? ' on' : ''}`}
                  aria-pressed={choice === player.joinOrder}
                  disabled={done || busy}
                  onClick={() => {
                    setThanks(null);
                    setChoice(player.joinOrder);
                  }}
                >
                  <span>{player.name}</span>
                  {done ? <small>{t('match.report.sent')}</small> : null}
                </button>
              </li>
            );
          })}
        </ul>
        {thanks !== null ? (
          <p className="report-thanks" role="status">
            {t('match.report.thanks', { name: thanks })}
          </p>
        ) : null}
        {error ? <ErrorNote error={error} /> : null}
        <div className="report-foot">
          {chosen ? (
            <button
              type="button"
              className="button button-danger"
              disabled={busy}
              onClick={() => void report(chosen)}
              data-testid="report-confirm"
            >
              {t('match.report.confirm', { name: chosen.name })}
            </button>
          ) : (
            <button type="button" className="button" onClick={onClose}>
              {t('match.report.close')}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
