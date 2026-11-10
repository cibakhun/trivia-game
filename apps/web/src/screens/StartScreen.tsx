import type { WorldsResponse } from '@rdw/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, newActionKey } from '../api/client.ts';
import { ClientError, ErrorNote } from '../components/ErrorNote.tsx';
import { t } from '../i18n/i18n.ts';
import { navigate } from '../router.ts';
import { useSession } from '../session.tsx';

/** Start: Gastkonto anlegen, Welt wählen und beitreten; wer schon spielt, kommt zur Karte. */
export function StartScreen() {
  const { state, startGuest, reload } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [worlds, setWorlds] = useState<WorldsResponse['worlds'] | null>(null);

  const me = state.status === 'ready' ? state.me : null;
  // Auch ein gefallenes Reich führt zur Karte (dort steht der Hinweis); erneut beitreten geht nicht
  const playing = me?.instances.find((i) => i.kingdom !== null) ?? null;
  /** Ein Schlüssel je Beitrittsversuch und Welt, auch über einen erneuten Klick hinweg. */
  const joinKeys = useRef(new Map<string, string>());

  useEffect(() => {
    if (playing) navigate({ name: 'play', instanceId: playing.instanceId }, { replace: true });
  }, [playing]);

  const loadWorlds = useCallback(async (isCancelled: () => boolean = () => false) => {
    setError(null);
    try {
      const response = await api.worlds();
      if (!isCancelled()) setWorlds(response.worlds);
    } catch (e) {
      if (!isCancelled()) setError(e);
    }
  }, []);

  useEffect(() => {
    if (!me || playing) return;
    let cancelled = false;
    void loadWorlds(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [me, playing, loadWorlds]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function join(worldId: string) {
    const key = joinKeys.current.get(worldId) ?? newActionKey();
    joinKeys.current.set(worldId, key);
    const joined = await api.join(worldId, key);
    // Fertig ist der Beitritt erst, wenn das Profil das neue Reich kennt. Scheitert das Nachladen,
    // bleibt der Schlüssel: Ein erneuter Klick liefert denselben Beitritt (Idempotenz) statt
    // ALREADY_JOINED und lädt das Profil noch einmal.
    const me = await reload();
    if (!me?.instances.some((i) => i.instanceId === joined.instanceId && i.kingdom !== null)) {
      throw new ClientError('start.joinIncomplete');
    }
    joinKeys.current.delete(worldId);
    navigate({ name: 'play', instanceId: joined.instanceId });
  }

  return (
    <main className="start">
      <h1>{t('app.title')}</h1>
      <p className="tagline">{t('start.tagline')}</p>
      {state.status === 'loading' ? <p>{t('app.loading')}</p> : null}
      {state.status === 'error' ? (
        <ErrorNote error={state.error} onRetry={() => void reload()} />
      ) : null}
      {state.status === 'anonymous' ? (
        <section className="card">
          <button
            type="button"
            className="button button-primary"
            disabled={busy}
            onClick={() => void run(startGuest)}
          >
            {t('start.guest')}
          </button>
          <p className="muted">{t('start.guestHint')}</p>
        </section>
      ) : null}
      {me && !playing ? (
        <section className="card" aria-labelledby="worlds-title">
          <h2 id="worlds-title">{t('start.chooseWorld')}</h2>
          {worlds === null && !error ? <p>{t('app.loading')}</p> : null}
          {worlds?.length === 0 ? <p>{t('start.noWorlds')}</p> : null}
          <ul className="world-list">
            {worlds?.map((world) => {
              // Der Server tritt der neuesten laufenden Instanz bei (Liste aufsteigend nach Start)
              const instance = world.instances.at(-1);
              return (
                <li key={world.id} className="world" data-testid={`world-${world.slug}`}>
                  <div>
                    <strong>{t(`start.worldMode.${world.mode}`)}</strong>
                    <span className="muted"> · {world.slug}</span>
                    {instance ? (
                      <div className="muted">
                        {t('start.worldPlayers', {
                          participants: instance.participants,
                          capacity: instance.capacity,
                        })}
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={busy || !instance || instance.status !== 'RUNNING' || instance.joined}
                    onClick={() => void run(() => join(world.id))}
                  >
                    {t('start.join')}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {error ? (
        <ErrorNote
          error={error}
          {...(me && worlds === null ? { onRetry: () => void loadWorlds() } : {})}
        />
      ) : null}
    </main>
  );
}
