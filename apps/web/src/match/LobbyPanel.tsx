import { matchMap } from '@rdw/game-core';
import {
  MATCH_BOT_STRENGTH_CODES,
  MATCH_MAP_BY_SEATS,
  type MatchBotStrengthCode,
  type MatchPlayer,
  type MatchView,
} from '@rdw/protocol';
import { useEffect, useState } from 'react';
import { ErrorNote } from '../components/ErrorNote.tsx';
import { t, tp } from '../i18n/i18n.ts';
import { inviteLink } from '../router.ts';

/**
 * Aufstellung: Einladungslink und Code, Plätze, Start durch den Gastgeber. In einer normalen Partie
 * setzt der Gastgeber auf freie Plätze Bots (ADR-052), gestartet wird ab zwei Mitspielern (Menschen
 * und Bots). In einer Testpartie gehen freie Plätze beim Start von selbst an Bots.
 */
export function LobbyPanel({
  view,
  busy,
  error,
  onStart,
  onLeave,
  onSetBot,
}: {
  readonly view: MatchView;
  readonly busy: boolean;
  readonly error: unknown;
  readonly onStart: () => void;
  readonly onLeave: () => void;
  readonly onSetBot: (joinOrder: number, strength: MatchBotStrengthCode | null) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const { match, players } = view;
  const host = players.find((p) => p.isHost);
  const test = match.kind === 'TEST';
  const capacity = match.seats ?? MAX_SEATS;
  // Testpartie: Die freien Plätze füllen beim Start Bots, ohne dass sie jemand setzt
  const autoBots = test && match.seats !== null ? Math.max(0, match.seats - players.length) : 0;
  const canStart = test || players.length >= 2;
  const canSetBots = view.isHost && !test;
  const hasBots = players.some((p) => p.isBot);
  const seats = Array.from({ length: Math.max(capacity, players.length) }, (_, joinOrder) => ({
    joinOrder,
    player: players.find((p) => p.joinOrder === joinOrder) ?? null,
  }));
  // Erst die belegten Plätze; freie dahinter, in Testpartien zuerst die für Bots
  const taken = seats.filter((s) => s.player !== null);
  const free = seats.filter((s) => s.player === null);
  const seconds = (ms: number) => Math.round(ms / 1000);
  const mapOf = (count: 2 | 3) => {
    const map = matchMap(MATCH_MAP_BY_SEATS[count]);
    return { name: map.name, regions: map.regions.length };
  };
  const [duo, trio] = [mapOf(2), mapOf(3)];

  return (
    <section className="card lobby stack" aria-labelledby="lobby-title" data-testid="match-lobby">
      <h2 id="lobby-title">{t('match.lobby.title')}</h2>
      {match.inviteCode ? <InviteCode code={match.inviteCode} /> : null}
      <h3>{t('match.lobby.players')}</h3>
      <ul className="lobby-seats">
        {taken.map(({ joinOrder, player }) =>
          player ? (
            <li
              key={joinOrder}
              className={`lobby-seat taken${player.isBot ? ' bot' : ''}`}
              data-testid="lobby-seat"
            >
              <PlayerShield name={player.name} />
              <span className="lobby-name">
                {player.isMe ? t('match.you', { name: player.name }) : player.name}
              </span>
              {player.isHost ? <span className="badge">{t('match.lobby.host')}</span> : null}
              {player.isBot && canSetBots ? (
                <BotControls player={player} busy={busy} onSetBot={onSetBot} />
              ) : null}
            </li>
          ) : null,
        )}
        {free.map(({ joinOrder }, i) => (
          <li key={joinOrder} className="lobby-seat free" data-testid="lobby-seat">
            <PlayerShield name={null} />
            <span className="lobby-name">
              {i < autoBots ? t('match.lobby.botSeat') : t('match.lobby.freeSeat')}
            </span>
            {canSetBots ? (
              <button
                type="button"
                className="button button-small lobby-add-bot"
                disabled={busy}
                onClick={() => onSetBot(joinOrder, 'MEDIUM')}
              >
                {t('match.lobby.addBot')}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {autoBots > 0 ? <p className="muted">{tp('match.lobby.bots', autoBots)}</p> : null}
      {hasBots && !test ? <p className="muted">{t('match.lobby.botsNote')}</p> : null}
      <p className="muted">
        {t('match.lobby.maps', {
          duo: duo.name,
          duoRegions: duo.regions,
          trio: trio.name,
          trioRegions: trio.regions,
        })}
      </p>
      <p className="muted">
        {t('match.lobby.timers', {
          trivia: seconds(match.timers.triviaMs),
          estimate: seconds(match.timers.estimateMs),
          pick: seconds(match.timers.pickMs),
        })}
      </p>
      {error ? <ErrorNote error={error} /> : null}
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

/** Stärke eines gesetzten Bots ändern oder ihn wieder entfernen (nur der Gastgeber). */
function BotControls({
  player,
  busy,
  onSetBot,
}: {
  readonly player: MatchPlayer;
  readonly busy: boolean;
  readonly onSetBot: (joinOrder: number, strength: MatchBotStrengthCode | null) => void;
}) {
  const id = `lobby-bot-${player.joinOrder}`;
  return (
    <span className="lobby-bot-controls">
      <label className="visually-hidden" htmlFor={id}>
        {t('match.lobby.botStrength', { name: player.name })}
      </label>
      <select
        id={id}
        value={player.botStrength ?? 'MEDIUM'}
        disabled={busy}
        onChange={(e) => onSetBot(player.joinOrder, e.target.value as MatchBotStrengthCode)}
      >
        {MATCH_BOT_STRENGTH_CODES.map((level) => (
          <option key={level} value={level}>
            {t(`match.bot.${level}`)}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="button button-small button-quiet"
        disabled={busy}
        aria-label={t('match.lobby.removeBotOf', { name: player.name })}
        onClick={() => onSetBot(player.joinOrder, null)}
      >
        {t('match.lobby.removeBot')}
      </button>
    </span>
  );
}

/**
 * Einladung: der Code als Buchstabenplättchen und ein Knopf, der den Einladungslink kopiert. Wer
 * den Link öffnet, tritt der Aufstellung bei (`JoinScreen`). Lässt der Browser das Kopieren nicht
 * zu (etwa ohne HTTPS im Heimnetz), steht der Link zum Markieren da.
 */
function InviteCode({ code }: { readonly code: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const link = inviteLink(code);
  const canCopy = !failed && typeof navigator !== 'undefined' && navigator.clipboard !== undefined;
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
          className="button invite-copy"
          onClick={() => {
            void navigator.clipboard.writeText(link).then(
              () => setCopied(true),
              () => setFailed(true),
            );
          }}
        >
          {copied ? t('match.lobby.copied') : t('match.lobby.copy')}
        </button>
      ) : (
        <span className="invite-link" data-testid="invite-link">
          {link}
        </span>
      )}
      <span className="visually-hidden" aria-live="polite">
        {copied ? t('match.lobby.copied') : ''}
      </span>
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
