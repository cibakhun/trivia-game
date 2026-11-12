import {
  QUESTION_CATEGORIES,
  type MatchBotStrengthCode,
  type MatchView,
  type QuestionCategory,
} from '@rdw/protocol';
import { useState } from 'react';
import { CategoryIcon } from '../art/RealmIcons.tsx';
import { describeError, ErrorNote } from '../components/ErrorNote.tsx';
import { t, tp } from '../i18n/i18n.ts';
import { LobbyPanel, PlayerShield } from './LobbyPanel.tsx';
import { categoryName } from './realm-text.ts';

/**
 * Aufstellung der Partie mit Ausbau (MATCH_RULES §11.1): Jeder wählt hier seine
 * Lieblingskategorien; über sie wirken später die Lose im Glücksrad. Die Wahl gilt, sobald genau
 * so viele gewählt sind, wie die Regeln verlangen, und wird dann gespeichert. Als gewählt steht sie
 * erst da, wenn der Server sie bestätigt hat; scheitert das Speichern, sagt das Blatt es und bietet
 * an, es noch einmal zu versuchen. Daneben stehen die Mitspieler und der Start; Einladungslink, Bots
 * und Absage liegen auf dem zweiten Blatt (`LobbyPanel`, wie in der Partie ohne Ausbau).
 */

function sameSet(a: readonly QuestionCategory[], b: readonly QuestionCategory[]): boolean {
  return a.length === b.length && a.every((category) => b.includes(category));
}

/** Eine Wahl unabhängig von der Reihenfolge, in der sie angetippt wurde. */
function keyOf(categories: readonly QuestionCategory[]): string {
  return [...categories].sort().join(',');
}

/** Letzter Versuch, die eigene Wahl zu speichern: für welche Wahl, und ob er scheiterte. */
interface SaveAttempt {
  readonly key: string;
  readonly failed: boolean;
}

/** Vorgabe für Standbilder (Prüfstand): eine vollständige Wahl, die der Server noch nicht hat. */
export interface RealmLobbyInitial {
  readonly chosen: readonly QuestionCategory[];
  /** Das Speichern ist gescheitert, statt noch unterwegs zu sein. */
  readonly failed?: boolean;
}

export function RealmLobby({
  view,
  busy,
  error,
  onStart,
  onLeave,
  onSetBot,
  onSetFavorites,
  onHelp,
  initial,
}: {
  readonly view: MatchView;
  readonly busy: boolean;
  readonly error: unknown;
  readonly onStart: () => void;
  readonly onLeave: () => void;
  readonly onSetBot: (joinOrder: number, strength: MatchBotStrengthCode | null) => void;
  /** Öffnet „So geht's“. */
  readonly onHelp: () => void;
  /** Speichert die Wahl; `true`, wenn der Server sie angenommen hat. */
  readonly onSetFavorites: (categories: readonly QuestionCategory[]) => Promise<boolean>;
  readonly initial?: RealmLobbyInitial | undefined;
}) {
  const realm = view.realm;
  const me = view.players.find((p) => p.isMe) ?? null;
  const saved = me?.favorites ?? null;
  const [page, setPage] = useState<'favorites' | 'seats'>('favorites');
  const [chosen, setChosen] = useState<readonly QuestionCategory[]>(initial?.chosen ?? saved ?? []);
  const [attempt, setAttempt] = useState<SaveAttempt | null>(
    initial ? { key: keyOf(initial.chosen), failed: initial.failed ?? false } : null,
  );
  const count = realm?.favoritesCount ?? 0;
  const full = chosen.length === count;
  // Gewählt heißt: Der Server hat genau diese Wahl. Bis dahin ist sie unterwegs oder das Speichern
  // ist gescheitert; sonst hielte man eine Wahl für sicher, die beim Start durch eine zufällige
  // ersetzt würde.
  const stored = saved !== null && sameSet(saved, chosen);
  const underway = attempt !== null && attempt.key === keyOf(chosen) && !attempt.failed;
  const failed = full && !stored && !underway;

  // Die Wahl gilt erst vollständig; dann geht sie gleich an den Server
  const save = (categories: readonly QuestionCategory[]) => {
    const key = keyOf(categories);
    setAttempt({ key, failed: false });
    void onSetFavorites(categories).then((accepted) => {
      // Nur der Ausgang des letzten Versuchs zählt; angenommen heißt: warten, bis die Ansicht es zeigt
      if (!accepted) setAttempt((last) => (last?.key === key ? { key, failed: true } : last));
    });
  };

  if (!realm) return null;

  if (page === 'seats') {
    return (
      <LobbyPanel
        view={view}
        busy={busy}
        error={error}
        onStart={onStart}
        onLeave={onLeave}
        onSetBot={onSetBot}
        headAction={
          <button
            type="button"
            className="button button-small"
            data-testid="lobby-to-favorites"
            onClick={() => setPage('favorites')}
          >
            {t('realm.favorites.toFavorites')}
          </button>
        }
      />
    );
  }

  const { match, players } = view;
  const host = players.find((p) => p.isHost);
  const canStart = match.kind === 'TEST' || players.length >= 2;
  const toggle = (category: QuestionCategory) => {
    const next = chosen.includes(category)
      ? chosen.filter((c) => c !== category)
      : chosen.length < count
        ? [...chosen, category]
        : chosen;
    if (next === chosen) return;
    setChosen(next);
    if (next.length === count && !(saved && sameSet(saved, next))) save(next);
  };
  const statusOf = (player: MatchView['players'][number]): string => {
    if (player.isBot) return t('realm.favorites.random');
    if (player.isMe) {
      if (!full) return t('realm.favorites.choosingMe', { count: count - chosen.length });
      if (stored) return t('realm.favorites.chosenMe', { count });
      return failed ? t('realm.favorites.unsaved') : t('realm.favorites.saving');
    }
    return player.favorites ? t('realm.favorites.chosen') : t('realm.favorites.choosing');
  };

  return (
    <section
      className="sheet lobby fav-sheet"
      aria-labelledby="fav-title"
      data-testid="match-favorites"
    >
      <div className="lobby-main">
        <header className="fav-head">
          <h2 id="fav-title">{t('realm.favorites.title')}</h2>
          <span
            className={`fav-count${full && stored ? ' full' : ''}`}
            data-testid="fav-count"
            aria-live="polite"
          >
            {t('realm.favorites.count', { chosen: chosen.length, count })}
          </span>
        </header>
        <ul className="fav-grid">
          {QUESTION_CATEGORIES.map((category) => {
            const on = chosen.includes(category);
            const available = realm.categories.includes(category);
            return (
              <li key={category}>
                <button
                  type="button"
                  className={`fav${on ? ' on' : ''}`}
                  aria-pressed={on}
                  aria-label={
                    available
                      ? undefined
                      : t('realm.favorites.unavailable', { category: categoryName(category) })
                  }
                  disabled={busy || !available || (!on && full)}
                  data-category={category}
                  data-available={available ? 'true' : 'false'}
                  onClick={() => toggle(category)}
                >
                  <CategoryIcon category={category} size={24} />
                  <span>{categoryName(category)}</span>
                  {on ? (
                    <span className="fav-check" aria-hidden="true">
                      ✓
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
        {failed ? (
          <div className="note note-error fav-failed" role="alert" data-testid="fav-failed">
            <p>
              {t('realm.favorites.failed')}
              {error ? ` ${describeError(error)}` : null}
            </p>
            <button
              type="button"
              className="button"
              data-testid="fav-retry"
              disabled={busy}
              onClick={() => save(chosen)}
            >
              {t('realm.favorites.retry')}
            </button>
          </div>
        ) : (
          <div className="fav-foot">
            <p className="fav-note">
              {t('realm.favorites.note')} {t('realm.favorites.startHint', { count })}{' '}
              <strong>{tp('realm.favorites.goal', view.realm?.campaignRounds ?? 0)}</strong>
            </p>
            <button
              type="button"
              className="button fav-help"
              data-testid="lobby-help"
              onClick={onHelp}
            >
              {t('realm.help.open')}
            </button>
          </div>
        )}
      </div>
      <div className="lobby-side fav-side">
        <h3>{t('realm.favorites.side')}</h3>
        <ul className="fav-seats">
          {players.map((player) => (
            <li key={player.joinOrder} data-testid="fav-seat">
              <PlayerShield name={player.name} />
              <span>
                <strong>{player.isMe ? t('match.you', { name: player.name }) : player.name}</strong>
                <small>{statusOf(player)}</small>
              </span>
            </li>
          ))}
        </ul>
        {error && !failed ? <ErrorNote error={error} /> : null}
        {view.isHost ? (
          <button
            type="button"
            className="button button-primary button-wide"
            disabled={busy || !canStart}
            onClick={onStart}
          >
            {t('match.lobby.start')}
          </button>
        ) : (
          <p className="fav-wait" aria-live="polite">
            {t('match.lobby.waitingHost', { name: host?.name ?? '?' })}
          </p>
        )}
        <button
          type="button"
          className="button"
          data-testid="lobby-to-seats"
          onClick={() => setPage('seats')}
        >
          {t('realm.favorites.toSeats')}
        </button>
      </div>
    </section>
  );
}
