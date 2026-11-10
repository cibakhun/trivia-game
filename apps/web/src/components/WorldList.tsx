import type { KingdomNamePartsDto, WorldsResponse } from '@rdw/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionKey, api } from '../api/client.ts';
import { t } from '../i18n/i18n.ts';
import { navigate } from '../router.ts';
import { useSession } from '../session.tsx';
import { ClientError, ErrorNote } from './ErrorNote.tsx';
import { NamePicker, type NameChoice } from './NamePicker.tsx';

type KingdomChoice = NameChoice<KingdomNamePartsDto>;
type World = WorldsResponse['worlds'][number];

/**
 * Welten zum Weiterspielen oder Beitreten. Beim Beitritt wird der Reichsname aus Vorschlägen
 * gewählt (O-10); gegründet wird erst mit „Reich gründen“.
 */
export function WorldList() {
  const { reload } = useSession();
  const [worlds, setWorlds] = useState<WorldsResponse['worlds'] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [kingdomName, setKingdomName] = useState<KingdomChoice | null>(null);
  /** Ein Schlüssel je Welt, auch über einen erneuten Klick nach einem Netzfehler hinweg. */
  const joinKeys = useRef(new Map<string, ActionKey>());

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
    let cancelled = false;
    void loadWorlds(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadWorlds]);

  // Der Server tritt der neuesten laufenden Instanz bei (Liste aufsteigend nach Start)
  const choosingInstance = worlds?.find((w) => w.id === choosing)?.instances.at(-1)?.id ?? null;
  const loadKingdomNames = useCallback(async () => {
    if (!choosingInstance) return [];
    return (await api.kingdomNames(choosingInstance)).suggestions;
  }, [choosingInstance]);

  async function join(worldId: string) {
    const key = joinKeys.current.get(worldId) ?? new ActionKey();
    joinKeys.current.set(worldId, key);
    setBusy(true);
    setError(null);
    try {
      let joinedInstance: string;
      try {
        joinedInstance = (await api.join(worldId, key.current, kingdomName?.parts)).instanceId;
      } catch (e) {
        key.settle(e);
        throw e;
      }
      // Fertig ist der Beitritt erst, wenn das Profil das neue Reich kennt. Scheitert das
      // Nachladen, bleibt der Schlüssel: Ein erneuter Klick liefert denselben Beitritt
      // (Idempotenz) statt ALREADY_JOINED und lädt das Profil noch einmal.
      const me = await reload();
      if (!me?.instances.some((i) => i.instanceId === joinedInstance && i.kingdom !== null)) {
        throw new ClientError('start.joinIncomplete');
      }
      key.settle();
      joinKeys.current.delete(worldId);
      navigate({ name: 'play', instanceId: joinedInstance });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  function choose(world: World) {
    setChoosing(world.id);
    setKingdomName(null);
    setError(null);
  }

  return (
    <section className="card" aria-labelledby="worlds-title">
      <h2 id="worlds-title">{t('start.chooseWorld')}</h2>
      {worlds === null && !error ? <p>{t('app.loading')}</p> : null}
      {worlds?.length === 0 ? <p>{t('start.noWorlds')}</p> : null}
      <ul className="world-list">
        {worlds?.map((world) => {
          const instance = world.instances.at(-1);
          const mine = world.instances.find((i) => i.joined);
          return (
            <li key={world.id} className="world" data-testid={`world-${world.slug}`}>
              <div className="world-row">
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
                  {mine ? <div className="badge">{t('worlds.yours')}</div> : null}
                </div>
                {mine ? (
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() => navigate({ name: 'play', instanceId: mine.id })}
                  >
                    {t('start.play')}
                  </button>
                ) : choosing !== world.id ? (
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={busy || !instance || instance.status !== 'RUNNING'}
                    onClick={() => choose(world)}
                  >
                    {t('start.join')}
                  </button>
                ) : null}
              </div>
              {choosing === world.id && !mine ? (
                <div className="join-panel">
                  <NamePicker
                    legend={t('names.kingdomLegend')}
                    hint={t('names.kingdomHint')}
                    load={loadKingdomNames}
                    value={kingdomName}
                    onChange={setKingdomName}
                    testId="kingdom-name-picker"
                  />
                  <div className="actions">
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={busy || !kingdomName}
                      onClick={() => void join(world.id)}
                    >
                      {t('start.found')}
                    </button>
                    <button
                      type="button"
                      className="button button-quiet"
                      disabled={busy}
                      onClick={() => setChoosing(null)}
                    >
                      {t('start.cancel')}
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {error ? (
        <ErrorNote
          error={error}
          {...(worlds === null ? { onRetry: () => void loadWorlds() } : {})}
        />
      ) : null}
    </section>
  );
}
