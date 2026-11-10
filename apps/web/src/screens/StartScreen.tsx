import type { WorldsResponse } from '@rdw/protocol';
import { useEffect, useState } from 'react';
import { api } from '../api/client.ts';
import { ErrorNote } from '../components/ErrorNote.tsx';
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
  const playing = me?.instances.find((i) => i.kingdom?.status === 'ACTIVE') ?? null;

  useEffect(() => {
    if (playing) navigate({ name: 'play', instanceId: playing.instanceId }, { replace: true });
  }, [playing]);

  useEffect(() => {
    if (!me || playing) return;
    let cancelled = false;
    api
      .worlds()
      .then((response) => {
        if (!cancelled) setWorlds(response.worlds);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [me, playing]);

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
    const joined = await api.join(worldId);
    await reload();
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
              const instance = world.instances[0];
              return (
                <li key={world.id} className="world">
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
                    disabled={busy || !instance || instance.status !== 'RUNNING'}
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
      {error ? <ErrorNote error={error} /> : null}
    </main>
  );
}
