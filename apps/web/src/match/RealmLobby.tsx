import {
  QUESTION_CATEGORIES,
  type MatchBotStrengthCode,
  type MatchView,
  type QuestionCategory,
} from '@rdw/protocol';
import { useEffect, useState } from 'react';
import { CategoryIcon } from '../art/RealmIcons.tsx';
import { ErrorNote } from '../components/ErrorNote.tsx';
import { t } from '../i18n/i18n.ts';
import { LobbyPanel, PlayerShield } from './LobbyPanel.tsx';
import { categoryName } from './realm-text.ts';

/**
 * Aufstellung der Partie mit Ausbau (MATCH_RULES §11.1): Jeder wählt hier seine
 * Lieblingskategorien; über sie wirken später die Lose im Glücksrad. Die Wahl gilt, sobald genau
 * so viele gewählt sind, wie die Regeln verlangen, und wird dann gespeichert. Daneben stehen die
 * Mitspieler und der Start; Einladungslink, Bots und Absage liegen auf dem zweiten Blatt
 * (`LobbyPanel`, wie in der Partie ohne Ausbau).
 */

function sameSet(a: readonly QuestionCategory[], b: readonly QuestionCategory[]): boolean {
  return a.length === b.length && a.every((category) => b.includes(category));
}

export function RealmLobby({
  view,
  busy,
  error,
  onStart,
  onLeave,
  onSetBot,
  onSetFavorites,
}: {
  readonly view: MatchView;
  readonly busy: boolean;
  readonly error: unknown;
  readonly onStart: () => void;
  readonly onLeave: () => void;
  readonly onSetBot: (joinOrder: number, strength: MatchBotStrengthCode | null) => void;
  readonly onSetFavorites: (categories: readonly QuestionCategory[]) => void;
}) {
  const realm = view.realm;
  const me = view.players.find((p) => p.isMe) ?? null;
  const saved = me?.favorites ?? null;
  const [page, setPage] = useState<'favorites' | 'seats'>('favorites');
  const [chosen, setChosen] = useState<readonly QuestionCategory[]>(saved ?? []);
  const count = realm?.favoritesCount ?? 0;
  const full = chosen.length === count;

  // Die Wahl gilt erst vollständig; dann geht sie gleich an den Server
  useEffect(() => {
    if (!full || count === 0 || (saved && sameSet(saved, chosen))) return;
    onSetFavorites(chosen);
    // Nur wenn sich die eigene Wahl ändert
  }, [chosen.join(',')]);

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
  const toggle = (category: QuestionCategory) =>
    setChosen((current) =>
      current.includes(category)
        ? current.filter((c) => c !== category)
        : current.length < count
          ? [...current, category]
          : current,
    );
  const statusOf = (player: MatchView['players'][number]): string => {
    if (player.isBot) return t('realm.favorites.random');
    if (player.isMe) {
      return full
        ? t('realm.favorites.chosenMe', { count })
        : t('realm.favorites.choosingMe', { count: count - chosen.length });
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
            className={`fav-count${full ? ' full' : ''}`}
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
        <p className="fav-note">
          {t('realm.favorites.note')} {t('realm.favorites.startHint', { count })}
        </p>
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
        {error ? <ErrorNote error={error} /> : null}
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
