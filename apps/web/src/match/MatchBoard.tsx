import { DEFAULT_MATCH_RULES } from '@rdw/protocol';
import { hexDistance, type MatchMap } from '@rdw/game-core';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { ArtDefs, symbolRef, type SymbolId } from '../art/ArtDefs.tsx';
import {
  attackSource,
  duelLayout,
  duelScale,
  inUpperHalf,
  type DuelLayout,
} from '../art/attack.ts';
import { FxLayer } from '../art/fx/FxLayer.tsx';
import { frontiers, mapArt, type ArtRegion, type MapArt } from '../art/map-art.ts';
import { COMPACT_SCALE, seaDepth, type StageFrame } from '../art/stage-frame.ts';
import { formatNumber, t, tp } from '../i18n/i18n.ts';
import '../art/map-art.css';
import { boardFx } from './board-fx.ts';
import type { DuelStage } from './match-model.ts';
import type { SeatName } from './match-text.ts';
import {
  hasBuilding,
  REALM_CASTLE,
  RealmPlanArt,
  RealmRegionArt,
  RealmRuinArt,
  type RealmLayer,
} from './RealmBoardArt.tsx';

/**
 * Karte der Partie im Stil „Alte Landkarte“ (docs/ART_DIRECTION.md): Regionen mit natürlichen
 * Grenzen, Meer, Fluss und Landschaftsmotiven. Besitz zeigt eine Aquarellfarbe je Sitz plus
 * Wappenmuster und Wappenbild (nicht nur Farbe), Hauptstädte eine Burg mit Schilden als Leben,
 * jede Region ihren Punktwert als Münze. Wählbare Regionen sind Schaltflächen mit goldener Kante.
 * Ein Duell spielt auf der Karte: Alles außer den zwei beteiligten Regionen tritt zurück, die
 * Wappen von Angreifer und Verteidiger stehen sich an der Grenze gegenüber, und nach der
 * Entscheidung zeigt die Karte den Ausgang (`DuelStageArt`). Eroberung, Wertzuwachs und Treffer
 * auf die Burg sind kurz animiert (nicht bei „Bewegung reduzieren“).
 *
 * Die Partie mit Ausbau zeigt dieselbe Karte mit einer Ebene mehr (`realm`): Gebäude, Armeen und
 * die Pläne der Rüstzeit (`RealmBoardArt`).
 */

/** Was die Karte von einem Feld braucht; die Ansichten beider Spielarten passen darauf. */
export interface BoardRegionState {
  readonly owner: number | null;
  readonly value: number;
  /** Sitz, dessen Burg hier steht: die Hauptstadt, mit Ausbau jede Burg. */
  readonly capitalOf: number | null;
}

export interface BoardState {
  readonly regions: readonly BoardRegionState[];
  /** Leben der Hauptstadt je Sitz; mit Ausbau zählt jede Burg ihre eigenen (`RealmLayer`). */
  readonly seats: readonly { readonly capitalLivesLeft: number }[];
}

/** So weit reicht das Meer über das Kartenblatt hinaus (Karteneinheiten): genug für jeden Bildschirm. */
const SEA = 3000;
/** Kachel der Wellen jenseits des Kartenblatts, in Wellenabständen. */
const FAR_COLUMNS = 12;
const FAR_ROWS = 9;

/** `true` ab dem zweiten Rendern: Beim ersten Aufbau läuft keine Änderungsanimation. */
function useSettled(): boolean {
  const settled = useRef(false);
  useEffect(() => {
    settled.current = true;
  }, []);
  return settled.current;
}

/** Wo ein Duell spielt: Region, aus der der Angreifer zieht, und ob das Ziel eine Hauptstadt ist. */
interface DuelGround {
  readonly source: number | null;
  readonly castle: boolean;
}

const NO_GROUND: DuelGround = { source: null, castle: false };
const NONE: readonly number[] = [];

/**
 * Schauplatz des Duells, festgehalten beim ersten Bild. Er bleibt für dieses Duell stehen, auch
 * wenn der Ausgang Besitzer und Hauptstadt ändert: Sonst spränge das Wappen des Angreifers mitten
 * in der Bewegung um, und eine gefallene Burg wäre weg, ehe sie fallen kann.
 */
function useDuelGround(map: MatchMap, board: BoardState, duel: DuelStage | null): DuelGround {
  const [kept, setKept] = useState<(DuelGround & { readonly key: string }) | null>(null);
  if (!duel) return NO_GROUND;
  const key = `${duel.attacker}:${duel.region}`;
  if (kept?.key === key) return kept;
  const capital = board.regions.findIndex((r) => r.capitalOf === duel.attacker);
  const source = attackSource(
    map,
    { owner: board.regions.map((r) => r.owner), capital: capital < 0 ? null : capital },
    duel.attacker,
    duel.region,
  );
  const ground = {
    key,
    source,
    castle: (board.regions[duel.region]?.capitalOf ?? null) !== null,
  };
  // Merken während des Renderns: React rendert sofort neu, ohne das Zwischenbild zu zeigen
  if (source !== null) setKept(ground);
  return ground;
}

export function MatchBoard({
  map,
  board,
  name,
  legal,
  duel,
  spot,
  busy,
  onPick,
  frame,
  realm = null,
  home = null,
  selectable = NONE,
}: {
  readonly map: MatchMap;
  readonly board: BoardState;
  readonly name: SeatName;
  /** Wählbare Regionen, nur wenn dieser Spieler dran ist. */
  readonly legal: readonly number[];
  /** Partie mit Ausbau: Gebäude, Armeen und Pläne über der Karte. */
  readonly realm?: RealmLayer | null;
  /** Der eigene Sitz: Die Außengrenze seines Reichs trägt eine helle Linie. */
  readonly home?: number | null;
  /**
   * Felder, die einen Tipp annehmen, ohne als Wahl hervorgehoben zu sein (Rüstzeit: die eigenen).
   * Auch sie melden sich über `onPick`.
   */
  readonly selectable?: readonly number[];
  /** Laufendes oder eben entschiedenes Duell und was die Karte davon gerade zeigt. */
  readonly duel: DuelStage | null;
  /** Eben gewählte Region, die eine Ansage zeigt. */
  readonly spot: number | null;
  readonly busy: boolean;
  readonly onPick: (region: number) => void;
  /**
   * Ausschnitt der Bühne (ADR-059): Die Karte füllt den Bildschirm, das Meer läuft bis zum Rand.
   * `null`, solange die Bühne nicht gemessen ist; dann zeigt die Karte nur das Land.
   */
  readonly frame: StageFrame | null;
}) {
  const art = useMemo(() => mapArt(map), [map]);
  const prefix = `map${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const settled = useSettled();
  const svg = useRef<SVGSVGElement>(null);
  // Kleines Land (Handy): größere Schrift, weniger Zierde
  const narrow = frame === null || frame.scale < COMPACT_SCALE;
  const far = useMemo(() => farSea(art), [art]);
  // Die Außengrenzen hängen nur an den Besitzern: Der Schlüssel hält sie über Abfragen hinweg fest
  const ownerKey = board.regions.map((r) => r.owner ?? '-').join(',');
  const realms = useMemo(
    () =>
      frontiers(
        art,
        ownerKey.split(',').map((owner) => (owner === '-' ? null : Number(owner))),
      ),
    [art, ownerKey],
  );
  const [hot, setHot] = useState<number | null>(null);
  const choosable = new Set(busy ? [] : legal);
  const tappable = new Set(busy ? [] : selectable);
  const maxLives = Math.max(
    DEFAULT_MATCH_RULES.capital.lives,
    ...board.seats.map((s) => s.capitalLivesLeft),
    ...(realm?.regions.map((r) => r.castleLives) ?? []),
  );
  /** Leben der Burg auf einem Feld: mit Ausbau ihre eigenen, sonst die der Hauptstadt des Sitzes. */
  const livesAt = (region: number, capitalOf: number | null): number =>
    capitalOf === null
      ? 0
      : (realm?.regions[region]?.castleLives ?? board.seats[capitalOf]?.capitalLivesLeft ?? 0);
  const s = art.size;

  function onKey(event: KeyboardEvent, region: number) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onPick(region);
    }
  }

  const contested = duel?.region ?? null;
  // Eine angegriffene Hauptstadt behält ihre Burg: Sie steht selbst für den Verteidiger
  const { source, castle } = useDuelGround(map, board, duel);
  const layout = useMemo(
    () =>
      contested === null || source === null
        ? null
        : duelLayout(art, source, contested, { scale: duelScale(narrow), castle }),
    [art, source, contested, narrow, castle],
  );
  // Steht das Duell oben auf der Karte, weicht ein Band über der Karte nach unten
  const high = contested !== null && inUpperHalf(art, [source, contested]);
  // Besitzer vor dem Ausgang: Unter der einlaufenden Farbe des Siegers bleibt die alte stehen,
  // bis sie überdeckt ist
  const deciding = duel?.scene === 'outcome';
  const ownersBefore = useRef<readonly (number | null)[] | null>(null);
  useEffect(() => {
    if (!deciding) ownersBefore.current = board.regions.map((r) => r.owner);
  });
  const before = deciding ? ownersBefore.current : null;
  // Armeen vor dem Ausgang: Ein genommenes Feld verliert alle, das Ereignis nennt nur eine
  const resolving = realm?.motion?.kind === 'outcome';
  const armiesBefore = useRef<readonly number[] | null>(null);
  useEffect(() => {
    if (!resolving) armiesBefore.current = realm?.regions.map((r) => r.armies) ?? null;
  });
  const armiesSeen = resolving ? armiesBefore.current : null;
  // Der Sieger nimmt die Region: Seine Farbe läuft von der Grenze her ein, über die er kam
  const conquest =
    duel?.scene === 'outcome' && (duel.effect === 'CONQUERED' || duel.effect === 'TAKEOVER');
  const flood: CSSProperties | undefined =
    conquest && layout
      ? {
          ['--flood-x' as string]: `${Math.round(50 - layout.dir.x * 45)}%`,
          ['--flood-y' as string]: `${Math.round(50 - layout.dir.y * 45)}%`,
        }
      : undefined;
  // Wo ein Wappen steht, weichen Name, Münze und Burg; vor einer angegriffenen Burg nur der Name
  const standing = layout !== null && (duel?.scene === 'announce' || duel?.scene === 'duel');
  const staged = (region: number): 'all' | 'name' | null =>
    !standing
      ? null
      : region === source
        ? 'all'
        : region === contested
          ? castle
            ? 'name'
            : // Auf einem freien Feld steht kein Wappen: Name und Münze bleiben
              duel?.defender === null
              ? null
              : 'all'
          : null;
  // Fällt ein Reich, läuft die Farbe des Siegers von der Hauptstadt aus Region um Region weiter
  const wave = (region: number): CSSProperties | undefined => {
    if (duel?.effect !== 'TAKEOVER') return undefined;
    const from = map.regions[duel.region]?.cell;
    const to = map.regions[region]?.cell;
    return from && to ? { ['--wave' as string]: `${hexDistance(from, to) * 0.12}s` } : undefined;
  };
  // Effekte über der Karte (ADR-068): nur für Wechsel, die die Seite miterlebt hat
  const fx = useMemo(
    () => boardFx({ art, duel, layout, castle, realm, live: settled }),
    [art, duel, layout, castle, realm, settled],
  );
  const quake: CSSProperties | undefined = fx.quake
    ? { ['--quake-at' as string]: `${fx.quake.atMs}ms` }
    : undefined;
  const hotArt =
    hot !== null && (choosable.has(hot) || tappable.has(hot)) ? art.regions[hot] : undefined;
  const spotArt = spot === null ? undefined : art.regions[spot];
  const spotOwner = spot === null ? null : (board.regions[spot]?.owner ?? null);

  const viewBox = frame?.viewBox ?? art.tightViewBox;
  const depth = seaDepth(viewBox) ?? {
    cx: art.width / 2,
    cy: art.height / 2,
    r: Math.hypot(art.width, art.height) / 2,
  };

  // Der Rahmen ist das Rasterfeld, die Karte füllt ihn: Als Rasterfeld mit `height: 100%` wird das
  // SVG in WebKit (iPhone) so hoch wie das ganze Raster und rutscht unter das Blatt.
  return (
    <div className={`board-frame${fx.quake ? ` quake-${fx.quake.strength}` : ''}`} style={quake}>
      <svg
        ref={svg}
        className={`board map-art${narrow ? ' narrow' : ''}`}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid slice"
        role="group"
        aria-label={t('match.board.label', { name: map.name })}
        data-testid="match-board"
        data-duel={duel?.scene}
        data-effect={duel?.effect ?? undefined}
        data-duel-high={high ? '' : undefined}
      >
        <ArtDefs prefix={prefix} />
        <defs>
          <pattern
            id={`${prefix}-far`}
            width={far.width}
            height={far.height}
            patternUnits="userSpaceOnUse"
          >
            <g className="sea-marks">
              {far.marks.map((w, i) => (
                <use
                  key={i}
                  href={symbolRef(prefix, 'sea')}
                  x={w.x - w.size / 2}
                  y={w.y - w.size / 2}
                  width={w.size}
                  height={w.size}
                />
              ))}
            </g>
          </pattern>
          {art.regions.map((region) => (
            <clipPath key={region.id} id={`${prefix}-clip-${region.id}`}>
              <path d={region.d} />
            </clipPath>
          ))}
          {/* In Karteneinheiten um das sichtbare Bild, nicht um das riesige Rechteck des Meers */}
          <radialGradient
            id={`${prefix}-depth`}
            gradientUnits="userSpaceOnUse"
            cx={depth.cx}
            cy={depth.cy}
            r={depth.r}
          >
            <stop offset="0.5" className="depth-near" />
            <stop offset="1" className="depth-far" />
          </radialGradient>
          {/* Goldener Schein hinter eben Geändertem: eine eigene Form statt eines Filters (WebKit) */}
          <radialGradient id={`${prefix}-glow`}>
            <stop offset="0.35" className="glow-in" />
            <stop offset="1" className="glow-out" />
          </radialGradient>
          <clipPath id={`${prefix}-land`}>
            <path d={art.coast} />
          </clipPath>
          {realms.map((r) => (
            <clipPath key={r.seat} id={`${prefix}-realm-${r.seat}`}>
              {r.regions.map((id) => (
                <path key={id} d={art.regions[id]?.d} />
              ))}
            </clipPath>
          ))}
        </defs>

        <rect
          className="sea"
          x={-SEA}
          y={-SEA}
          width={art.width + 2 * SEA}
          height={art.height + 2 * SEA}
        />
        {/* Jenseits des Kartenblatts: dasselbe Meer mit Wellen als Muster, das Blatt bleibt frei */}
        <path
          className="sea-far"
          aria-hidden="true"
          fill={`url(#${prefix}-far)`}
          fillRule="evenodd"
          d={`M${-SEA} ${-SEA}H${art.width + SEA}V${art.height + SEA}H${-SEA}ZM0 0V${art.height}H${art.width}V0Z`}
        />
        <g className="sea-marks" aria-hidden="true">
          {art.waves.map((w, i) => (
            <use
              key={i}
              href={symbolRef(prefix, 'sea')}
              x={w.x - w.size / 2}
              y={w.y - w.size / 2}
              width={w.size}
              height={w.size}
            />
          ))}
        </g>
        <rect
          className="sea-depth"
          aria-hidden="true"
          fill={`url(#${prefix}-depth)`}
          x={-SEA}
          y={-SEA}
          width={art.width + 2 * SEA}
          height={art.height + 2 * SEA}
        />
        <g className="coast-ripples" aria-hidden="true">
          <path d={art.coast} className="ripple ripple-3" />
          <path d={art.coast} className="ripple ripple-2" />
          <path d={art.coast} className="ripple ripple-1" />
          <path d={art.coast} className="coast-hatch" />
        </g>

        <g className="regions">
          {art.regions.map((region) => {
            const state = board.regions[region.id];
            if (!state) return null;
            const owner = state.owner;
            const canPick = choosable.has(region.id);
            const canTap = canPick || tappable.has(region.id);
            const ownerName = owner === null ? t('match.board.free') : name(owner);
            const built = realm?.regions[region.id];
            // Mit Ausbau nennt das Feld auch Gebäude und Armeen
            const label = built
              ? t('realm.board.region', {
                  name: region.name,
                  owner: ownerName,
                  building:
                    built.building === 'NONE'
                      ? t('realm.board.plain')
                      : t(`realm.building.${built.building}`),
                  armies: tp('realm.armies', built.armies),
                  value: state.value,
                })
              : t('match.board.region', {
                  name: region.name,
                  owner: ownerName,
                  value: state.value,
                });
            const capitalOf = state.capitalOf;
            const lives = livesAt(region.id, capitalOf);
            // Eben verloren: Die Farbe des alten Besitzers weicht erst unter der neuen
            const was = before?.[region.id] ?? null;
            const lost = was !== null && was !== owner ? was : null;
            const classes = [
              'board-region',
              owner === null ? 'free' : `seat-${owner}`,
              canPick ? 'legal' : '',
              contested === region.id ? 'contested' : '',
              contested === region.id && flood ? 'flooded' : '',
              capitalOf !== null ? 'capital' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <g
                key={region.id}
                className={classes}
                data-region={region.id}
                style={contested === region.id && flood ? flood : wave(region.id)}
                {...(canTap
                  ? {
                      role: 'button',
                      tabIndex: 0,
                      'aria-label': canPick ? region.name : label,
                      'aria-pressed': !canPick && realm ? realm.selected === region.id : undefined,
                      onClick: () => onPick(region.id),
                      onKeyDown: (event: KeyboardEvent) => onKey(event, region.id),
                      onPointerEnter: () => setHot(region.id),
                      onPointerLeave: () => setHot((h) => (h === region.id ? null : h)),
                      onFocus: () => setHot(region.id),
                      onBlur: () => setHot((h) => (h === region.id ? null : h)),
                    }
                  : { role: 'img', 'aria-label': label })}
              >
                <title>
                  {capitalOf === null
                    ? label
                    : realm
                      ? `${label} · ${tp('match.board.lives', lives)}`
                      : `${label} · ${t('match.board.capital')} · ${tp('match.board.lives', lives)}`}
                </title>
                <path d={region.d} className={`land terrain-${region.terrain}`} />
                {lost !== null ? (
                  <g className="wash wash-old">
                    <path
                      d={region.d}
                      className="wash-fill"
                      style={{ fill: `var(--seat-${lost})` }}
                    />
                    <path
                      d={region.d}
                      className="wash-pattern"
                      fill={`url(#${prefix}-pattern-${lost})`}
                    />
                  </g>
                ) : null}
                {owner !== null ? (
                  <g key={`wash-${owner}`} className={`wash${settled ? ' ink-in' : ''}`}>
                    <path d={region.d} className="wash-fill" />
                    <path
                      d={region.d}
                      className="wash-pattern"
                      fill={`url(#${prefix}-pattern-${owner})`}
                    />
                    <path
                      d={region.d}
                      className="wash-edge"
                      clipPath={`url(#${prefix}-clip-${region.id})`}
                    />
                  </g>
                ) : null}
                {canPick ? <path d={region.d} className="legal-glow" /> : null}
              </g>
            );
          })}
        </g>

        {/* Relief an der Küste und je Reich ein Farbband entlang seiner Außengrenze */}
        <path
          d={art.coast}
          className="coast-shade"
          clipPath={`url(#${prefix}-land)`}
          aria-hidden="true"
        />
        <g className="frontiers" aria-hidden="true">
          {realms.map((r) => (
            <g key={r.seat} className={`frontier seat-${r.seat}${r.seat === home ? ' home' : ''}`}>
              <path
                d={r.d}
                className="frontier-band"
                clipPath={`url(#${prefix}-realm-${r.seat})`}
              />
              {/* Dunkle Fassung unter der hellen Linie des eigenen Reichs, ohne Filter (WebKit) */}
              {r.seat === home ? <path d={r.d} className="frontier-casing" /> : null}
              <path d={r.d} className="frontier-line" />
            </g>
          ))}
        </g>

        <g className="region-borders" aria-hidden="true">
          {art.regions.map((region) => (
            <path key={region.id} d={region.d} />
          ))}
        </g>
        {art.river ? (
          <g className="river" aria-hidden="true">
            <path d={art.river} className="river-bank" />
            <path d={art.river} className="river-water" />
          </g>
        ) : null}
        <path d={art.coast} className="coastline" aria-hidden="true" />

        <g className="region-decor" aria-hidden="true">
          {art.regions.map((region) => (
            <RegionDecor
              key={region.id}
              prefix={prefix}
              region={region}
              built={
                (board.regions[region.id]?.capitalOf ?? null) !== null
                  ? 'castle'
                  : realm !== null && hasBuilding(realm, region.id)
                    ? 'building'
                    : null
              }
            />
          ))}
        </g>

        {realm ? (
          <RealmPlanArt
            prefix={prefix}
            art={art}
            layer={realm}
            owners={board.regions.map((r) => r.owner)}
            size={s}
            level="under"
          />
        ) : null}

        <g className="region-art" aria-hidden="true">
          {art.regions.map((region) => {
            const state = board.regions[region.id];
            if (!state) return null;
            return (
              <RegionArt
                key={region.id}
                prefix={prefix}
                region={region}
                owner={state.owner}
                value={state.value}
                capitalOf={state.capitalOf}
                lives={livesAt(region.id, state.capitalOf)}
                maxLives={maxLives}
                realm={realm}
                rising={realm?.motion?.fields[region.id]?.built === true}
                armiesSeen={armiesSeen?.[region.id]}
                settled={settled}
                staged={staged(region.id)}
                arriving={conquest && region.id === contested}
                size={s}
              />
            );
          })}
        </g>

        <g className="board-overlay" aria-hidden="true">
          {art.regions
            .filter((region) => choosable.has(region.id))
            .map((region) => (
              <path key={region.id} d={region.d} className="legal-ring" />
            ))}
          {hotArt ? <path d={hotArt.d} className="hot-ring" /> : null}
          {spotArt ? (
            <path
              key={spotArt.id}
              d={spotArt.d}
              className={`spot-ring${settled ? ' draw' : ''}`}
              style={{ ['--spot' as string]: `var(--seat-${spotOwner ?? 0})` }}
            />
          ) : null}
        </g>

        {realm ? (
          <RealmPlanArt
            prefix={prefix}
            art={art}
            layer={realm}
            owners={board.regions.map((r) => r.owner)}
            size={s}
            level="over"
          />
        ) : null}

        {/* Das Duell liegt über allem: Der Schleier nimmt auch Namen und Münzen der übrigen
            Regionen zurück */}
        {duel ? (
          <DuelStageArt
            key={`${duel.attacker}:${duel.region}`}
            prefix={prefix}
            art={art}
            duel={duel}
            source={source}
            layout={layout}
            castle={castle}
            fallingCastle={realm === null}
            size={s}
            enter={settled}
          />
        ) : null}

        {realm?.changes?.length ? (
          <RealmPlanArt
            prefix={prefix}
            art={art}
            layer={realm}
            owners={board.regions.map((r) => r.owner)}
            size={s}
            level="top"
          />
        ) : null}
      </svg>
      {fx.bursts.length > 0 ? <FxLayer key={fx.key} svg={svg} bursts={fx.bursts} /> : null}
    </div>
  );
}

/**
 * Wellen im Meer jenseits des Kartenblatts, damit das Meer bis zum Bildschirmrand gezeichnet ist:
 * eine Kachel, die sich wiederholt (ein Muster statt tausender einzelner Zeichen). Fest gewürfelt,
 * jede Karte zeigt immer dieselben; am Kachelrand bleibt Platz, damit kein Zeichen zerschnitten wird.
 */
function farSea(art: MapArt): {
  readonly width: number;
  readonly height: number;
  readonly marks: readonly { x: number; y: number; size: number }[];
} {
  let seed = 20261111;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const step = 0.85 * art.size;
  const width = FAR_COLUMNS * step;
  const height = FAR_ROWS * step;
  const edge = 0.2 * art.size;
  const marks: { x: number; y: number; size: number }[] = [];
  for (let row = 0; row < FAR_ROWS; row++) {
    for (let column = 0; column < FAR_COLUMNS; column++) {
      const x = (column + 0.5 + (rand() - 0.5) * 0.7) * step;
      const y = (row + 0.5 + (rand() - 0.5) * 0.5) * step;
      const size = art.size * (0.22 + rand() * 0.1);
      if (rand() < 0.35) continue;
      marks.push({
        x: Math.min(width - edge, Math.max(edge, x)),
        y: Math.min(height - edge, Math.max(edge, y)),
        size,
      });
    }
  }
  return { width, height, marks };
}

/** Landschaftsmotive einer Region; wo gebaut ist, weicht die Szene über dem Namen. */
function RegionDecor({
  prefix,
  region,
  built,
}: {
  readonly prefix: string;
  readonly region: ArtRegion;
  /** Burg: nur die unteren Ecken bleiben; anderes Gebäude: Ecken und Spitzen bleiben. */
  readonly built: 'castle' | 'building' | null;
}) {
  return (
    <>
      {region.decor
        .filter((d) => (built === 'castle' ? d.slot === 'side' : !built || d.slot !== 'top'))
        .map((d, i) => (
          <use
            key={i}
            href={symbolRef(prefix, d.kind)}
            x={d.x - d.size / 2}
            y={d.y - d.size / 2}
            width={d.size}
            height={d.size}
            transform={d.flip ? `translate(${2 * d.x} 0) scale(-1 1)` : undefined}
            className="decor"
          />
        ))}
    </>
  );
}

function RegionArt({
  prefix,
  region,
  owner,
  value,
  capitalOf,
  lives,
  maxLives,
  settled,
  staged,
  arriving,
  size: s,
  realm,
  rising,
  armiesSeen,
}: {
  readonly prefix: string;
  readonly region: ArtRegion;
  readonly owner: number | null;
  readonly value: number;
  readonly capitalOf: number | null;
  readonly lives: number;
  readonly maxLives: number;
  /** Partie mit Ausbau: Gebäude und Banner statt des Besitzerschilds. */
  readonly realm: RealmLayer | null;
  /** Eben gebaut (Aufdecken): Eine neue Burg wächst aus dem Boden. */
  readonly rising: boolean;
  /** Armeen hier vor dem Ausgang, soweit gesehen. */
  readonly armiesSeen: number | undefined;
  readonly settled: boolean;
  /** Hier steht gerade das Wappen eines Duells: Die Beschriftung tritt zurück, ganz oder nur der Name. */
  readonly staged: 'all' | 'name' | null;
  /** Eben erobert: Die neue Beschriftung wartet, bis das Wappen des Siegers geht. */
  readonly arriving: boolean;
  readonly size: number;
}) {
  const { cx, cy } = region;
  const capital = capitalOf !== null;
  const use = (id: SymbolId, x: number, y: number, size: number, extra?: string) => (
    <use
      href={symbolRef(prefix, id)}
      x={x - size / 2}
      y={y - size / 2}
      width={size}
      height={size}
      className={extra}
    />
  );
  const armies = realm?.regions[region.id]?.armies ?? 0;
  const withArmy =
    realm !== null && owner !== null && (armies > 0 || (realm.recruits?.[region.id] ?? 0) > 0);
  // Mit Ausbau: Gebäude oben, Name in der Mitte, Bannerträger unten; neben einer Burg steht er rechts
  const castleX = realm
    ? withArmy
      ? cx + REALM_CASTLE.beside * s
      : cx
    : withArmy
      ? cx - 0.32 * s
      : cx - 0.12 * s;
  const castleSize = realm ? REALM_CASTLE.size * s : 0.62 * s;
  // Neben einer Burg mit Armee liegt die Münze unter dem Bannerträger, rechts der Lebensschilde
  const coinX = realm
    ? capital
      ? cx + (withArmy ? 0.27 : 0.44) * s
      : withArmy
        ? cx + 0.5 * s
        : cx
    : owner === null
      ? cx
      : cx + 0.13 * s;
  const coinY = realm
    ? capital
      ? cy + (withArmy ? 0.6 : 0.54) * s
      : cy + 0.46 * s
    : capital
      ? cy + 0.08 * s
      : cy + 0.3 * s;
  // Mit Ausbau steht der Wert nur, wo eine gehaltene Verteidigung ihn über das Übliche hebt (§11.7)
  const showCoin = realm === null || (realm.regions[region.id]?.held ?? 0) > 0;
  const nameY = capital ? cy - (realm ? 0.56 : 0.47) * s : realm ? cy : cy - 0.06 * s;
  const livesX = realm ? castleX : cx;
  // Fällt hier eben ein Gebäude eine Stufe, kehrt die Beschriftung sofort zurück: Man soll es fallen sehen
  const motion = realm?.motion?.fields[region.id];
  const prompt = motion?.fell !== undefined && motion.fell !== 'CASTLE';
  // Eine genommene Burg ist im neuen Stand schon fort: Sie stürzt ein, wo sie stand
  const ruin = motion?.fell === 'CASTLE' && !capital ? motion : null;
  return (
    <>
      {ruin ? (
        <RealmRuinArt
          prefix={prefix}
          region={region}
          size={s}
          motion={ruin}
          lives={maxLives}
          armiesSeen={armiesSeen}
        />
      ) : null}
      <g
        className={`region-label${owner === null ? ' free' : ` seat-${owner}`}${staged ? ` staged-${staged}` : ''}${arriving ? ' arriving' : ''}${prompt ? ' prompt' : ''}`}
      >
        {capital ? (
          <>
            <g
              key={`castle-${lives}`}
              className={`castle${rising ? ' rising' : settled && lives < maxLives ? ' hit' : ''}`}
              style={{ ['--flag' as string]: `var(--seat-${capitalOf})` }}
            >
              {use('castle', castleX, cy + (realm ? REALM_CASTLE.y : 0.02) * s, castleSize)}
            </g>
            <g className="lives">
              {Array.from({ length: maxLives }, (_, i) => {
                const left = i < lives;
                const x = livesX + (i - (maxLives - 1) / 2) * REALM_CASTLE.livesGap * s;
                return (
                  <g
                    key={`${i}-${left ? 'on' : 'off'}`}
                    className={`life ${left ? 'life-on' : `life-off${settled ? ' breaking' : ''}`}`}
                    style={{ ['--flag' as string]: `var(--seat-${capitalOf})` }}
                  >
                    {use(
                      'shield',
                      x,
                      cy + (realm ? REALM_CASTLE.livesY : 0.5) * s,
                      REALM_CASTLE.life * s,
                    )}
                  </g>
                );
              })}
            </g>
          </>
        ) : null}
        <text x={cx} y={nameY} className="board-name">
          {region.name}
        </text>
        {realm ? (
          <RealmRegionArt
            prefix={prefix}
            region={region}
            owner={owner}
            castle={capital}
            size={s}
            layer={realm}
            armiesSeen={armiesSeen}
          />
        ) : owner !== null ? (
          <g className="owner-badge">
            {use('shield', cx - 0.2 * s, coinY, 0.27 * s, `badge-shield seat-fill-${owner}`)}
            {use(
              `emblem-${owner}` as SymbolId,
              cx - 0.2 * s,
              coinY - 0.015 * s,
              0.11 * s,
              'badge-emblem',
            )}
          </g>
        ) : null}
        {showCoin ? (
          <g key={`coin-${value}`} className={`coin${settled ? ' pop' : ''}`}>
            <circle cx={coinX} cy={coinY} r={(realm ? 0.17 : 0.2) * s} />
            <text x={coinX} y={coinY + 0.01 * s} className="board-value">
              {formatNumber(value)}
            </text>
          </g>
        ) : null}
      </g>
    </>
  );
}

/**
 * Bühne eines Duells (docs/ART_DIRECTION.md §4). Vier Bilder nacheinander:
 * `announce` Aufmarsch: Schleier über allem Übrigen, das Wappen des Angreifers setzt sich in seine
 * Region, der Pfeil schießt über die Grenze, das Wappen des Verteidigers stellt sich.
 * `duel` dasselbe als stehendes Bild, solange gefragt wird.
 * `outcome` Ausgang: Der Sieger stößt durch oder wehrt ab, der Verlierer weicht.
 * `settled` Rest der Auflösung: nur noch der Rand in der Farbe des Siegers.
 * Ohne Animation (laufende Frage, „Bewegung reduzieren“) steht überall das Endbild.
 */
function DuelStageArt({
  prefix,
  art,
  duel,
  source,
  layout,
  castle,
  fallingCastle,
  size: s,
  enter,
}: {
  readonly prefix: string;
  readonly art: MapArt;
  readonly duel: DuelStage;
  /** Region, aus der angegriffen wird; `null`, wenn keine eigene angrenzt. */
  readonly source: number | null;
  readonly layout: DuelLayout | null;
  /** Das Ziel ist eine Hauptstadt: Statt eines Wappens steht dort ihre Burg. */
  readonly castle: boolean;
  /** Die Burg einer eingenommenen Hauptstadt fällt hier; mit Ausbau lässt die Karte sie einstürzen. */
  readonly fallingCastle: boolean;
  readonly size: number;
  /** Aufmarsch abspielen (nicht beim ersten Aufbau der Seite). */
  readonly enter: boolean;
}) {
  const target = art.regions[duel.region];
  if (!target) return null;
  const from = source === null ? undefined : art.regions[source];
  // Schleier über das Land mit Löchern für die zwei Regionen des Duells. Das Meer füllt den ganzen
  // Bildschirm und bleibt hell (ADR-059)
  const veil = `${art.coast}${target.d}${from ? from.d : ''}`;
  const px = (n: number) => `${Math.round(n * 10) / 10}px`;
  // Schlag auf eine Burg: bis kurz vor die Mauer, nicht darüber
  const strike = layout ? Math.max(0, layout.distance - layout.radius - 0.36 * art.size) : 0;
  const impact = layout ? strike + layout.radius : 0;
  const style: CSSProperties = {
    ['--attacker' as string]: `var(--seat-${duel.attacker})`,
    // Freies Feld: kein Verteidiger; bleibt es frei, hat der Rand die Farbe der Tinte
    ['--defender' as string]:
      duel.defender === null ? 'var(--map-ink)' : `var(--seat-${duel.defender})`,
    ['--winner' as string]:
      duel.winner !== null
        ? `var(--seat-${duel.winner})`
        : duel.repelled
          ? 'var(--map-ink)'
          : undefined,
    ...(layout
      ? {
          ['--ux' as string]: layout.dir.x.toFixed(3),
          ['--uy' as string]: layout.dir.y.toFixed(3),
          ['--unit' as string]: px(layout.unit),
          // Wege des Angreiferwappens: in die Mitte des Ziels, vor die Burg
          ['--into-x' as string]: px(layout.target.x - layout.source.x),
          ['--into-y' as string]: px(layout.target.y - layout.source.y),
          ['--strike-x' as string]: px(layout.dir.x * strike),
          ['--strike-y' as string]: px(layout.dir.y * strike),
        }
      : {}),
  };
  const won = duel.winner === duel.attacker ? ' attack-won' : duel.repelled ? ' held' : '';
  const classes = `duel-stage scene-${duel.scene}${won}${enter && duel.scene === 'announce' ? ' enter' : ''}`;
  return (
    <g className={classes} style={style} aria-hidden="true">
      <path d={veil} fillRule="evenodd" className="duel-veil" />
      {from && duel.scene !== 'settled' ? <path d={from.d} className="duel-ring source" /> : null}
      <path d={target.d} className="duel-ring target" />
      {layout && duel.scene !== 'settled' ? (
        <>
          {duel.scene === 'outcome' ? (
            // Der Schlag: ein Ring, der sich vom Treffer aus weitet
            <circle
              cx={
                duel.effect === 'CAPITAL_HIT'
                  ? layout.source.x + layout.dir.x * impact
                  : layout.target.x
              }
              cy={
                duel.effect === 'CAPITAL_HIT'
                  ? layout.source.y + layout.dir.y * impact
                  : layout.target.y
              }
              r={layout.radius}
              className="duel-burst"
            />
          ) : null}
          <g className="duel-arrow">
            <path d={layout.arrow} />
          </g>
          {castle ? (
            // Die Burg einer eingenommenen Hauptstadt ist auf der Karte schon fort: Hier fällt sie
            fallingCastle && duel.scene === 'outcome' && duel.effect === 'TAKEOVER' ? (
              <g className="duel-castle" style={{ ['--flag' as string]: 'var(--defender)' }}>
                <use
                  href={symbolRef(prefix, 'castle')}
                  x={layout.target.x - 0.12 * s - 0.31 * s}
                  y={layout.target.y + 0.02 * s - 0.31 * s}
                  width={0.62 * s}
                  height={0.62 * s}
                />
              </g>
            ) : null
          ) : duel.defender === null ? null : (
            <DuelToken
              prefix={prefix}
              role="defender"
              seat={duel.defender}
              x={layout.target.x}
              y={layout.target.y}
              r={layout.radius}
            />
          )}
          <DuelToken
            prefix={prefix}
            role="attacker"
            seat={duel.attacker}
            x={layout.source.x}
            y={layout.source.y}
            r={layout.radius}
          />
        </>
      ) : null}
    </g>
  );
}

/**
 * Wappenplättchen eines Sitzes auf der Karte: helle Scheibe mit Rand in der Sitzfarbe, darauf
 * Schild und Wappenbild. Die Gruppen sind verschachtelt, weil jede Bewegung ihre eigene braucht:
 * Weg im Ausgang, Stoß im Takt, Größe.
 */
function DuelToken({
  prefix,
  role,
  seat,
  x,
  y,
  r,
}: {
  readonly prefix: string;
  readonly role: 'attacker' | 'defender';
  readonly seat: number;
  readonly x: number;
  readonly y: number;
  readonly r: number;
}) {
  const shield = r * 1.3;
  const emblem = r * 0.52;
  return (
    <g className={`duel-token ${role} seat-${seat}`}>
      <g className="token-nudge">
        <g className="token-body">
          <circle cx={x} cy={y + r * 0.14} r={r * 1.04} className="token-shadow" />
          <circle cx={x} cy={y} r={r} className="token-disc" />
          <use
            href={symbolRef(prefix, 'shield')}
            x={x - shield / 2}
            y={y - shield / 2 + r * 0.04}
            width={shield}
            height={shield}
            className={`token-shield seat-fill-${seat}`}
          />
          <use
            href={symbolRef(prefix, `emblem-${seat}` as SymbolId)}
            x={x - emblem / 2}
            y={y - emblem / 2 - r * 0.04}
            width={emblem}
            height={emblem}
            className="token-emblem"
          />
        </g>
      </g>
    </g>
  );
}
