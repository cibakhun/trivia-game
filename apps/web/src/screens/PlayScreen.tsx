import { axialKey, neighbors, type Axial } from '@rdw/game-core';
import type { AttackResponse, KingdomNamePartsDto, SiegesResponse } from '@rdw/protocol';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, newActionKey } from '../api/client.ts';
import { ErrorNote } from '../components/ErrorNote.tsx';
import { KingdomBar } from '../components/KingdomBar.tsx';
import { NamePicker, type NameChoice } from '../components/NamePicker.tsx';
import { RegionPanel } from '../components/RegionPanel.tsx';
import { SiegePanel } from '../components/SiegePanel.tsx';
import { t } from '../i18n/i18n.ts';
import { MapCanvas } from '../map/MapCanvas.tsx';
import type { MapRegion } from '../map/MapView.ts';
import { visibleChunks, type Bounds } from '../map/layout.ts';
import { biomeName, kingdomColor } from '../map/palette.ts';
import { useMapData } from '../map/useMapData.ts';
import { navigate } from '../router.ts';
import { useSession } from '../session.tsx';
import { rememberAttack } from './attack-memory.ts';

/** Ohne WebSocket (Phase 2) wird der Kartenzustand regelmäßig neu gelesen. */
const REFRESH_MS = 30_000;

/**
 * Karte mit Reichsanzeige, Belagerungen, Tutorial-Hinweis, angrenzenden Regionen und
 * Regionsdetails; nach einem Totalverlust die Neugründung.
 */
export function PlayScreen({ instanceId }: { readonly instanceId: string }) {
  const { state, reload } = useSession();
  const me = state.status === 'ready' ? state.me : null;
  const mine = me?.instances.find((i) => i.instanceId === instanceId) ?? null;
  const kingdom = mine?.kingdom ?? null;
  const { data, error, ensureChunks, refresh } = useMapData(instanceId);
  const [selected, setSelected] = useState<string | null>(null);
  const [centre, setCentre] = useState<Axial | null>(null);
  const [setupError, setSetupError] = useState<unknown>(null);
  const [sieges, setSieges] = useState<SiegesResponse | null>(null);
  // Eigener Fehler der Belagerungsliste: verschwindet mit dem nächsten erfolgreichen Laden
  const [siegeError, setSiegeError] = useState<unknown>(null);
  const [respawning, setRespawning] = useState(false);
  const [kingdomName, setKingdomName] = useState<NameChoice<KingdomNamePartsDto> | null>(null);
  const viewportTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Eine Neugründung = ein Schlüssel, auch nach einem Netzfehler
  const respawnKey = useRef(newActionKey());

  const loadSieges = useCallback(async () => {
    try {
      setSieges(await api.sieges(instanceId));
      setSiegeError(null);
    } catch (e) {
      setSiegeError(e);
    }
  }, [instanceId]);

  // Belagerungen beim Öffnen und mit jedem Neuladen von /me (z. B. neue eingehende Belagerung)
  const incomingCount = mine?.incomingSieges ?? 0;
  useEffect(() => {
    void loadSieges();
  }, [loadSieges, incomingCount]);

  // Ohne Teilnahme zurück zum Start; laufender Angriff (z. B. nach Reload) wird fortgesetzt
  useEffect(() => {
    if (state.status === 'ready' && !mine) navigate({ name: 'start' }, { replace: true });
    if (mine?.openChallengeId) {
      navigate({ name: 'challenge', challengeId: mine.openChallengeId }, { replace: true });
    }
  }, [state.status, mine]);

  // Startausschnitt: Hauptstadt und ihre Nachbar-Chunks
  const capitalId = kingdom?.capitalRegionId ?? null;
  useEffect(() => {
    if (!capitalId) return;
    let cancelled = false;
    api
      .region(instanceId, capitalId)
      .then(async (detail) => {
        if (cancelled) return;
        const { chunkX, chunkY, q, r } = detail.region;
        const around = [-1, 0, 1].flatMap((dy) =>
          [-1, 0, 1].map((dx) => ({ chunkX: chunkX + dx, chunkY: chunkY + dy })),
        );
        await ensureChunks(around);
        if (!cancelled) setCentre({ q, r });
      })
      .catch((e: unknown) => {
        if (!cancelled) setSetupError(e);
      });
    return () => {
      cancelled = true;
    };
  }, [instanceId, capitalId, ensureChunks]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void refresh();
      void reload();
      void loadSieges();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh, reload, loadSieges]);

  useEffect(
    () => () => {
      if (viewportTimer.current) clearTimeout(viewportTimer.current);
    },
    [],
  );

  const onViewport = useCallback(
    (bounds: Bounds) => {
      if (viewportTimer.current) clearTimeout(viewportTimer.current);
      viewportTimer.current = setTimeout(() => void ensureChunks(visibleChunks(bounds)), 250);
    },
    [ensureChunks],
  );

  const ownId = kingdom?.id ?? null;
  const regions = useMemo<MapRegion[]>(() => {
    const result: MapRegion[] = [];
    for (const region of data.statics.values()) {
      const regionState = data.states.get(region.id);
      const owner = regionState?.ownerKingdomId ?? null;
      const ownerKingdom = owner ? data.kingdoms.get(owner) : undefined;
      result.push({
        ...region,
        ownerColor: ownerKingdom ? kingdomColor(ownerKingdom.color) : null,
        own: owner !== null && owner === ownId,
        isCapital: regionState?.isCapital ?? false,
        underSiege: regionState?.underSiege ?? false,
        protected: (regionState?.protectedUntil ?? null) !== null,
      });
    }
    return result;
  }, [data, ownId]);

  // Barrierearme Alternative zur Karte: alle fremden Regionen an der eigenen Grenze
  const frontier = useMemo(() => {
    const byCell = new Map(regions.map((r) => [axialKey(r), r]));
    const result = regions.filter(
      (r) =>
        !r.own &&
        neighbors(r).some((n) => {
          const cell = byCell.get(axialKey(n));
          return cell?.own === true;
        }),
    );
    return result.sort((a, b) => a.tier - b.tier || (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  }, [regions]);

  const loadKingdomNames = useCallback(
    async () => (await api.kingdomNames(instanceId)).suggestions,
    [instanceId],
  );

  function onAttack(attack: AttackResponse, label: string) {
    rememberAttack(attack, label);
    navigate({ name: 'challenge', challengeId: attack.challengeId });
  }

  async function respawn() {
    setRespawning(true);
    setSetupError(null);
    try {
      await api.respawn(instanceId, respawnKey.current, kingdomName?.parts);
      respawnKey.current = newActionKey();
      setKingdomName(null);
      await reload();
      await refresh();
    } catch (e) {
      setSetupError(e);
    } finally {
      setRespawning(false);
    }
  }

  if (state.status === 'error') {
    return <ErrorNote error={state.error} onRetry={() => void reload()} />;
  }
  if (!mine) return <p className="centre">{t('app.loading')}</p>;

  const tutorial = mine.tutorialTargetRegionId;
  const ownerName = (region: MapRegion): string => {
    const owner = data.states.get(region.id)?.ownerKingdomId;
    return owner ? (data.kingdoms.get(owner)?.name ?? '') : t('kingdom.garrison');
  };

  return (
    <div className="play">
      {kingdom ? (
        <KingdomBar kingdom={kingdom}>
          <nav className="kingdom-nav" aria-label={t('nav.label')}>
            <button type="button" className="link" onClick={() => navigate({ name: 'worlds' })}>
              {t('nav.worlds')}
            </button>
            <button
              type="button"
              className="link"
              data-testid="nav-account"
              onClick={() => navigate({ name: 'account' })}
            >
              {me?.user.isGuest ? t('nav.secureAccount') : t('nav.account')}
            </button>
          </nav>
        </KingdomBar>
      ) : null}
      <div className="play-body">
        <MapCanvas
          regions={regions}
          selected={selected}
          highlighted={tutorial}
          centre={centre}
          onSelect={setSelected}
          onViewport={onViewport}
          onError={setSetupError}
        />
        <aside className="side">
          {kingdom?.status === 'FALLEN' ? (
            <section className="card card-accent" data-testid="fallen">
              <p className="note">{t('kingdom.fallen')}</p>
              <p>{t('kingdom.fallenHint')}</p>
              <NamePicker
                legend={t('names.kingdomLegend')}
                load={loadKingdomNames}
                value={kingdomName}
                onChange={setKingdomName}
                testId="kingdom-name-picker"
              />
              <button
                type="button"
                className="button button-primary"
                disabled={respawning || !kingdomName}
                onClick={() => void respawn()}
              >
                {respawning ? t('kingdom.respawning') : t('kingdom.respawn')}
              </button>
            </section>
          ) : null}
          {sieges &&
          (sieges.incoming.length > 0 || sieges.outgoing.length > 0 || sieges.recent.length > 0) ? (
            <SiegePanel sieges={sieges} onSelectRegion={setSelected} />
          ) : null}
          {tutorial ? (
            <section className="card card-accent" aria-labelledby="tutorial-title">
              <h2 id="tutorial-title">{t('tutorial.title')}</h2>
              <p>{t('tutorial.text')}</p>
              <button
                type="button"
                className="button button-primary"
                onClick={() => setSelected(tutorial)}
              >
                {t('tutorial.show')}
              </button>
            </section>
          ) : null}
          {selected ? (
            <RegionPanel
              key={selected}
              instanceId={instanceId}
              regionId={selected}
              ownKingdomId={ownId}
              onClose={() => setSelected(null)}
              onAttack={onAttack}
            />
          ) : null}
          <section className="card" aria-labelledby="frontier-title">
            <h2 id="frontier-title">{t('map.neighbours')}</h2>
            {frontier.length === 0 ? <p className="muted">{t('map.noNeighbours')}</p> : null}
            <ul className="frontier">
              {frontier.map((region) => {
                const biome = biomeName(region.biome);
                return (
                  <li key={region.id}>
                    <button
                      type="button"
                      className="link"
                      aria-pressed={selected === region.id}
                      onClick={() => setSelected(region.id)}
                    >
                      {t('map.neighbourItem', {
                        biome: biome ? t(`biome.${biome}`) : '?',
                        tier: region.tier,
                        owner: ownerName(region),
                      })}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
          {capitalId ? (
            <button
              type="button"
              className="button button-quiet"
              onClick={() => {
                const capital = regions.find((r) => r.id === capitalId);
                if (capital) setCentre({ q: capital.q, r: capital.r });
              }}
            >
              {t('map.centre')}
            </button>
          ) : null}
          {error || setupError || siegeError ? (
            <ErrorNote error={error ?? setupError ?? siegeError} />
          ) : null}
        </aside>
      </div>
    </div>
  );
}
