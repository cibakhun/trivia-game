import type { MatchView } from '@rdw/protocol';
import { useEffect, useState } from 'react';
import { t, tp } from '../i18n/i18n.ts';

/**
 * Aufstellung: Einladungscode, Teilnehmer, Start durch den Gastgeber. In einer Testpartie gehen
 * freie Plätze beim Start an Bots; eine normale Partie braucht mindestens zwei Menschen.
 */
export function LobbyPanel({
  view,
  busy,
  onStart,
  onLeave,
}: {
  readonly view: MatchView;
  readonly busy: boolean;
  readonly onStart: () => void;
  readonly onLeave: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const { match, players } = view;
  const host = players.find((p) => p.isHost);
  const botSeats = match.kind === 'TEST' && match.seats !== null ? match.seats - players.length : 0;
  const canStart = match.kind === 'TEST' || players.length >= 2;
  // Plätze als Schilde: belegt, für Bots reserviert oder frei (normale Partie bis zu drei)
  const freeSeats = Math.max(0, (match.seats ?? MAX_SEATS) - players.length);
  const seconds = (ms: number) => Math.round(ms / 1000);

  return (
    <section className="card lobby stack" aria-labelledby="lobby-title" data-testid="match-lobby">
      <h2 id="lobby-title">{t('match.lobby.title')}</h2>
      {match.inviteCode ? <InviteCode code={match.inviteCode} /> : null}
      <h3>{t('match.lobby.players')}</h3>
      <div className="lobby-seats">
        <ul className="lobby-players">
          {players.map((p) => (
            <li key={p.joinOrder}>
              <PlayerShield name={p.name} />
              <span className="lobby-name">
                {p.isMe ? t('match.you', { name: p.name }) : p.name}
              </span>
              {p.isHost ? <span className="badge">{t('match.lobby.host')}</span> : null}
            </li>
          ))}
        </ul>
        {freeSeats > 0 ? (
          <ul className="lobby-free" aria-label={t('match.lobby.freeSeats')}>
            {Array.from({ length: freeSeats }, (_, i) => (
              <li key={i}>
                <PlayerShield name={null} />
                <span className="lobby-name">
                  {i < botSeats ? t('match.lobby.botSeat') : t('match.lobby.freeSeat')}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {botSeats > 0 ? <p className="muted">{tp('match.lobby.bots', botSeats)}</p> : null}
      <p className="muted">
        {t('match.lobby.timers', {
          trivia: seconds(match.timers.triviaMs),
          estimate: seconds(match.timers.estimateMs),
          pick: seconds(match.timers.pickMs),
        })}
      </p>
      {view.isHost ? (
        <>
          {!canStart ? <p>{t('match.lobby.needPlayers')}</p> : null}
          <button
            type="button"
            className="button button-primary button-wide"
            disabled={busy || !canStart}
            onClick={onStart}
          >
            {t('match.lobby.start')}
          </button>
        </>
      ) : (
        <p aria-live="polite">{t('match.lobby.waitingHost', { name: host?.name ?? '?' })}</p>
      )}
      {confirming ? (
        <div className="note" role="group" aria-label={t('match.lobby.cancel')}>
          <p>{t('match.lobby.confirmCancel')}</p>
          <div className="actions">
            <button
              type="button"
              className="button button-danger"
              disabled={busy}
              onClick={onLeave}
            >
              {t('match.lobby.confirm')}
            </button>
            <button type="button" className="button" onClick={() => setConfirming(false)}>
              {t('match.lobby.keep')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="button button-quiet"
          disabled={busy}
          onClick={() => (view.isHost ? setConfirming(true) : onLeave())}
        >
          {view.isHost ? t('match.lobby.cancel') : t('match.lobby.leave')}
        </button>
      )}
      <p className="muted">{t('match.lobby.expires')}</p>
    </section>
  );
}

const MAX_SEATS = 3;

/** Einladungscode als Buchstabenplättchen mit Knopf zum Kopieren. */
function InviteCode({ code }: { readonly code: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const canCopy = typeof navigator !== 'undefined' && navigator.clipboard !== undefined;
  return (
    <div className="invite">
      <span className="muted">{t('match.lobby.code')}</span>
      <strong className="invite-code" data-testid="invite-code">
        {code.split('').map((letter, i) => (
          <span key={i} className="invite-tile">
            {letter}
          </span>
        ))}
      </strong>
      {canCopy ? (
        <button
          type="button"
          className="button button-quiet invite-copy"
          onClick={() => {
            void navigator.clipboard.writeText(code).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
        >
          {copied ? t('match.lobby.copied') : t('match.lobby.copy')}
        </button>
      ) : null}
      <p className="muted">{t('match.lobby.codeHint')}</p>
    </div>
  );
}

/** Schild für einen Platz: mit Anfangsbuchstaben, leer und gestrichelt, solange er frei ist. */
function PlayerShield({ name }: { readonly name: string | null }) {
  const initial = name?.trim().charAt(0).toUpperCase() ?? '';
  return (
    <svg
      className={`player-shield${name === null ? ' free' : ''}`}
      viewBox="-50 -52 100 104"
      width="30"
      height="31"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M-42-46H42V-4C42 24 18 40 0 50C-18 40-42 24-42-4Z" strokeWidth="6" />
      {initial ? (
        <text x="0" y="4" textAnchor="middle" dominantBaseline="middle">
          {initial}
        </text>
      ) : null}
    </svg>
  );
}
