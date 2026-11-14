import { DEFAULT_MATCH_RULES } from '@rdw/protocol';
import { hexDistance, type MatchMap } from '@rdw/game-core';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { ArtDefs, symbolRef, type SymbolId } from '../art/ArtDefs.tsx';
import {
  attackSource,
  DUEL_BACK,
  DUEL_GUARD,
  duelContact,
  duelContactOf,
  duelLayout,
  duelScale,
  inUpperHalf,
  type DuelContact,
  type DuelLayout,
} from '../art/attack.ts';
import { NO_FX } from '../art/fx/fx.ts';
import { FxLayer } from '../art/fx/FxLayer.tsx';
import { inkBlob, inkBox, inkOrigin, inkReach, inkStyle } from '../art/ink.ts';
import { frontiers, mapArt, type ArtRegion, type MapArt } from '../art/map-art.ts';
import { COMPACT_SCALE, seaDepth, type StageFrame } from '../art/stage-frame.ts';
import { formatNumber, t, tp } from '../i18n/i18n.ts';
import '../art/map-art.css';
import { boardFx, fxWitness, type FxWitness } from './board-fx.ts';
import type { DuelStage } from './match-model.ts';
import type { SeatName } from './match-text.ts';
import {
  armiesBefore as armiesBeforeMotion,
  hasBuilding,
  REALM_CASTLE,
  RealmPlanArt,
  RealmRegionArt,
  RealmRoutArt,
  RealmRuinArt,
  routed,
  ShieldShatter,
  useOutcomeMotion,
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

/**
 * Gruppe (oder mit `path` ein Pfad), deren Bewegung `motion` nur abspielt, wenn sie nach dem ersten
 * Aufbau der Karte erschienen ist. Das steht beim Erscheinen fest: Ein späteres Rendern hängt die
 * Klasse nicht nachträglich an, sonst liefe die Animation nach dem Laden mitten im Spiel an. Ein
 * neuer Stand braucht deshalb einen neuen Schlüssel (`key`).
 */
function Born({
  className,
  motion,
  live,
  style,
  path,
  children,
}: {
  readonly className: string;
  readonly motion: string;
  readonly live: boolean;
  readonly style?: CSSProperties;
  readonly path?: string;
  readonly children?: ReactNode;
}) {
  const [born] = useState(live);
  const classes = born && motion ? `${className} ${motion}` : className;
  return path === undefined ? (
    <g className={classes} style={style}>
      {children}
    </g>
  ) : (
    <path d={path} className={classes} style={style} />
  );
}

/** `true` ab dem zweiten Rendern: Beim ersten Aufbau läuft keine Änderungsanimation. */
function useSettled(): boolean {
  const settled = useRef(false);
  useEffect(() => {
    settled.current = true;
  }, []);
  return settled.current;
}

/**
 * Zeigt der Browser den Fokus dieses Elements (Tastatur)? Nach einem Tipp oder Klick nicht. Kennt
 * er die Abfrage nicht, gilt der Fokus als sichtbar.
 */
function focusShown(element: Element): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
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
  pending = null,
  onPick,
  frame,
  realm: realmLayer = null,
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
  /**
   * Eigene Wahl, die abgeschickt ist und auf den Server wartet (`pendingPick`): Das Feld trägt
   * schon den festen goldenen Rand, die übrigen Markierungen ruhen so lange.
   */
  readonly pending?: number | null;
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
  // Der Ausgang mit Ausbau spielt, wenn die Szene `outcome` kommt, nicht schon mit der Auflösung
  const realm = useOutcomeMotion(realmLayer, duel);
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
  // Solange eine Wahl unterwegs ist, nimmt die Karte keinen Tipp an
  const waiting = busy || pending !== null;
  const choosable = new Set(waiting ? [] : legal);
  const tappable = new Set(waiting ? [] : selectable);
  // Jeder Tipp bekommt seine Antwort im selben Bild: Die Fläche des Felds blitzt einmal auf
  // (`tap-press`). Die Nummer zählt die Tipps, damit auch ein zweiter auf dasselbe Feld neu anläuft
  const [tap, setTap] = useState<{ readonly region: number; readonly seq: number } | null>(null);
  const press = (region: number) => {
    setTap((last) => ({ region, seq: (last?.seq ?? 0) + 1 }));
    onPick(region);
  };
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
      press(region);
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
  // Die Außengrenzen der Reiche folgen der einlaufenden Farbe: Im Ausgang stehen die alten noch
  // und gehen erst in die neuen über, wenn die Tinte die Region gefüllt hat
  const beforeKey = before ? before.map((owner) => owner ?? '-').join(',') : null;
  const realmsBefore = useMemo(
    () =>
      beforeKey === null || beforeKey === ownerKey
        ? null
        : frontiers(
            art,
            beforeKey.split(',').map((owner) => (owner === '-' ? null : Number(owner))),
          ),
    [art, beforeKey, ownerKey],
  );
  // Armeen vor dem Ausgang: Ein genommenes Feld verliert alle, das Ereignis nennt nur eine
  const resolving = realmLayer?.motion?.kind === 'outcome';
  const armiesBefore = useRef<readonly number[] | null>(null);
  useEffect(() => {
    if (!resolving) armiesBefore.current = realm?.regions.map((r) => r.armies) ?? null;
  });
  const armiesSeen = resolving ? armiesBefore.current : null;
  // Der Sieger nimmt die Region: Seine Farbe läuft von der Grenze her ein, über die er kam
  const conquest =
    duel?.scene === 'outcome' && (duel.effect === 'CONQUERED' || duel.effect === 'TAKEOVER');
  const flood = conquest && layout !== null && source !== null;
  // Fällt ein Reich, läuft die Farbe von der genommenen Hauptstadt aus durch seine Regionen
  const fallen = duel?.effect === 'TAKEOVER' ? duel.region : null;
  // Nasse Tinte je Region (`ink-spread`): ein fest gewürfelter Klecks, der von der Grenze her
  // einläuft, über die der Sieger kam, beim Fall eines Reichs von der Seite der Hauptstadt her,
  // sonst von der Mitte aus. Ursprung und Reichweite stecken in Variablen, der Name bleibt
  const boxes = useMemo(() => art.regions.map((r) => inkBox(r.outline)), [art]);
  const inks = useMemo(
    () =>
      art.regions.map((region) => {
        const box = boxes[region.id] ?? inkBox(region.outline);
        const entry =
          flood && source !== null && region.id === contested
            ? art.regions[source]
            : fallen !== null && region.id !== fallen
              ? art.regions[fallen]
              : undefined;
        const origin = inkOrigin(
          region.outline,
          box,
          { x: region.cx, y: region.cy },
          entry ? { x: entry.cx, y: entry.cy } : null,
        );
        return inkStyle(inkBlob(`${map.id}:${region.id}`, origin, inkReach(origin)));
      }),
    [art, boxes, map.id, flood, contested, source, fallen],
  );
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
    // Höchstens drei Schritte: Die letzte Region ist gefüllt, bevor der Ausgang endet
    return from && to
      ? { ['--wave' as string]: `${Math.min(3, hexDistance(from, to)) * 0.12}s` }
      : undefined;
  };
  // Effekte über der Karte (ADR-070): nur für Wechsel, die die Seite miterlebt hat. Ob, steht
  // fest, wenn ein Satz Effekte erscheint (`fxWitness`): Lief ein Ausgang schon beim Laden, bleibt
  // er auch beim nächsten Rendern ohne Teilchen und Beben
  const fxAll = useMemo(
    () => boardFx({ art, duel, layout, castle, realm, live: true }),
    [art, duel, layout, castle, realm],
  );
  const [witness, setWitness] = useState<FxWitness | null>(null);
  const seen = fxWitness(witness, fxAll.key, settled);
  if (seen !== witness) setWitness(seen);
  const fx = seen.live ? fxAll : NO_FX;
  const quake: CSSProperties | undefined = fx.quake
    ? { ['--quake-at' as string]: `${fx.quake.atMs}ms` }
    : undefined;
  const hotArt =
    hot !== null && (choosable.has(hot) || tappable.has(hot)) ? art.regions[hot] : undefined;
  const tapArt = tap === null ? undefined : art.regions[tap.region];
  // Nur solange das Feld noch zur Wahl steht: Ist der neue Stand da, übernimmt der Ring der Ansage
  const pendingArt = pending !== null && legal.includes(pending) ? art.regions[pending] : undefined;
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
          {realmsBefore?.map((r) => (
            <clipPath key={r.seat} id={`${prefix}-was-${r.seat}`}>
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
            // Eben verloren: Die Farbe des alten Besitzers weicht erst unter der neuen. Das
            // umkämpfte Feld gehörte dem Verteidiger, auch wenn die Karte das nicht mehr weiß
            const was =
              before?.[region.id] ??
              (conquest && region.id === contested ? (duel?.defender ?? null) : null);
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
                style={wave(region.id)}
                {...(canTap
                  ? {
                      role: 'button',
                      tabIndex: 0,
                      'aria-label': canPick ? region.name : label,
                      'aria-pressed': !canPick && realm ? realm.selected === region.id : undefined,
                      onClick: () => press(region.id),
                      onKeyDown: (event: KeyboardEvent) => onKey(event, region.id),
                      // Der Rand unter dem Zeiger gehört der Maus und der Tastatur: Ein Finger
                      // hat keinen Zeiger, und nach einem Tipp bliebe der Rand am Feld hängen
                      onPointerEnter: (event: PointerEvent) => {
                        if (event.pointerType === 'mouse') setHot(region.id);
                      },
                      onPointerLeave: () => setHot((h) => (h === region.id ? null : h)),
                      onFocus: (event: FocusEvent) => {
                        if (focusShown(event.currentTarget)) setHot(region.id);
                      },
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
                  // Die alte Farbe weicht genau dort, wo die neue schon steht (`ink-recede`)
                  <g
                    className="wash wash-old"
                    style={{ ...inks[region.id], ['--old' as string]: `var(--seat-${lost})` }}
                  >
                    <path d={region.d} className="wash-fill" />
                    <path
                      d={region.d}
                      className="wash-pattern"
                      fill={`url(#${prefix}-pattern-${lost})`}
                    />
                    <path
                      d={region.d}
                      className="wash-edge"
                      clipPath={`url(#${prefix}-clip-${region.id})`}
                    />
                    <path d={region.d} className="ink-frame" />
                  </g>
                ) : null}
                {owner !== null ? (
                  <Wash
                    key={`wash-${owner}`}
                    prefix={prefix}
                    region={region}
                    owner={owner}
                    ink={inks[region.id]}
                    live={settled}
                  />
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
        {realmsBefore ? (
          <Frontiers realms={realmsBefore} clip={`${prefix}-was`} home={home} turning="was" />
        ) : null}
        <Frontiers
          realms={realms}
          clip={`${prefix}-realm`}
          home={home}
          turning={realmsBefore ? 'now' : null}
        />

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
            live={settled}
            home={home}
          />
        ) : null}

        {/* Antwort auf einen Tipp und die abgeschickte Wahl: unter den Beschriftungen */}
        <g className="board-press" aria-hidden="true">
          {tapArt && tap ? (
            <path
              key={tap.seq}
              d={tapArt.d}
              className={`tap-press${realm?.refused === tap.region ? ' refused' : ''}`}
            />
          ) : null}
          {pendingArt ? (
            <Born key={pendingArt.id} className="pick-ring" motion="land" live={settled}>
              <path d={pendingArt.d} className="ring-casing" />
              <path d={pendingArt.d} className="ring-line" />
            </Born>
          ) : null}
        </g>

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
            <Born
              key={spotArt.id}
              className="spot-ring"
              motion="draw"
              live={settled}
              style={{ ['--spot' as string]: `var(--seat-${spotOwner ?? 0})` }}
              path={spotArt.d}
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
            live={settled}
            label={(id) => {
              const region = art.regions[id];
              const state = board.regions[id];
              return region && state
                ? {
                    x: region.cx,
                    y: nameY(region.cy, state.capitalOf !== null, true, s),
                    text: region.name,
                  }
                : null;
            }}
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
            razed={
              realm
                ? realm.motion?.kind === 'outcome' &&
                  realm.motion.fields[duel.region]?.fell === 'CASTLE'
                : castle && duel.effect === 'TAKEOVER'
            }
            size={s}
            enter={settled}
            ink={flood && contested !== null ? inks[contested] : undefined}
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
            live={settled}
          />
        ) : null}
      </svg>
      {fx.bursts.length > 0 ? <FxLayer key={fx.key} svg={svg} bursts={fx.bursts} /> : null}
    </div>
  );
}

/**
 * Je Reich ein Farbband entlang seiner Außengrenze. Im Ausgang eines Duells gehen die Grenzen von
 * vorher (`was`) in die neuen (`now`) über, sobald die Farbe des Siegers eingelaufen ist.
 */
function Frontiers({
  realms,
  clip,
  home,
  turning,
}: {
  readonly realms: ReturnType<typeof frontiers>;
  /** Anfang der Kennung der Beschneidung je Reich. */
  readonly clip: string;
  readonly home: number | null;
  readonly turning: 'was' | 'now' | null;
}) {
  return (
    <g className={`frontiers${turning ? ` turning-${turning}` : ''}`} aria-hidden="true">
      {realms.map((r) => (
        <g key={r.seat} className={`frontier seat-${r.seat}${r.seat === home ? ' home' : ''}`}>
          <path d={r.d} className="frontier-band" clipPath={`url(#${clip}-${r.seat})`} />
          {/* Dunkle Fassung unter der hellen Linie des eigenen Reichs, ohne Filter (WebKit) */}
          {r.seat === home ? <path d={r.d} className="frontier-casing" /> : null}
          <path d={r.d} className="frontier-line" />
        </g>
      ))}
    </g>
  );
}

/**
 * Farbe eines Besitzers auf seiner Region, wie mit Aquarell lasiert. Kommt sie neu hinzu, läuft
 * sie als nasse Tinte ein (`ink-spread`) und trägt dabei eine dunklere nasse Kante, die beim
 * Trocknen verblasst (`ink-wet`). Ob sie einläuft, steht beim Erscheinen fest: Eine Farbe, die
 * schon beim ersten Aufbau der Karte da war, läuft auch später nicht mehr ein.
 */
function Wash({
  prefix,
  region,
  owner,
  ink,
  live,
}: {
  readonly prefix: string;
  readonly region: ArtRegion;
  readonly owner: number;
  /** Schlüsselbilder des Kleckses als Variablen (`inkStyle`). */
  readonly ink: CSSProperties | undefined;
  /** Die Seite hat den Wechsel miterlebt. */
  readonly live: boolean;
}) {
  const [inking] = useState(live);
  return (
    <>
      <g className={`wash${inking ? ' ink-in' : ''}`} style={inking ? ink : undefined}>
        <path d={region.d} className="wash-fill" />
        <path d={region.d} className="wash-pattern" fill={`url(#${prefix}-pattern-${owner})`} />
        <path d={region.d} className="wash-edge" clipPath={`url(#${prefix}-clip-${region.id})`} />
        {inking ? <path d={region.d} className="ink-frame" /> : null}
      </g>
      {inking ? (
        <g className="wash-wet" style={ink}>
          <path d={region.d} className="wet-fill" />
          <path d={region.d} className="ink-frame" />
        </g>
      ) : null}
    </>
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

/** Höhe, auf der der Name eines Felds steht: über einer Startburg, sonst in der Mitte. */
function nameY(cy: number, capital: boolean, realm: boolean, s: number): number {
  return capital ? cy - (realm ? 0.56 : 0.47) * s : realm ? cy : cy - 0.06 * s;
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
  const motion = realm?.motion?.fields[region.id];
  // Solange eine Armee noch aufbricht oder fällt, bleibt ihr Platz neben der Burg
  const withArmy =
    realm !== null &&
    owner !== null &&
    (armies > 0 ||
      (realm.recruits?.[region.id] ?? 0) > 0 ||
      armiesBeforeMotion(armies, motion ?? null) > 0);
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
  const nameAt = nameY(cy, capital, realm !== null, s);
  const livesX = realm ? castleX : cx;
  // Fällt hier eben ein Gebäude eine Stufe, kehrt die Beschriftung sofort zurück: Man soll es fallen sehen
  const prompt = motion?.fell !== undefined && motion.fell !== 'CASTLE';
  // Eine genommene Burg ist im neuen Stand schon fort: Sie stürzt ein, wo sie stand
  const ruin = motion?.fell === 'CASTLE' && !capital ? motion : null;
  // Mit Ausbau trifft der Schlag die Burg in der Szene `outcome`; ohne Ausbau zeigt es der Wechsel
  const struck = realm ? motion?.hit === true : settled && lives < maxLives;
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
      {motion && routed(motion, owner) ? (
        <RealmRoutArt
          prefix={prefix}
          region={region}
          size={s}
          motion={motion}
          armiesSeen={armiesSeen}
        />
      ) : null}
      <g
        className={`region-label${owner === null ? ' free' : ` seat-${owner}`}${staged ? ` staged-${staged}` : ''}${arriving ? ' arriving' : ''}${prompt ? ' prompt' : ''}`}
      >
        {capital ? (
          <>
            <Born
              key={`castle-${lives}`}
              className={`castle${rising ? ' rising' : realm && struck ? ' hit shaken' : ''}`}
              motion={!realm && !rising && struck ? 'hit' : ''}
              live={settled}
              style={{ ['--flag' as string]: `var(--seat-${capitalOf})` }}
            >
              {use('castle', castleX, cy + (realm ? REALM_CASTLE.y : 0.02) * s, castleSize)}
            </Born>
            <g
              className={`lives${motion?.placed === true ? ' placed' : ''}`}
              style={{ ['--flag' as string]: `var(--seat-${capitalOf})` }}
            >
              {Array.from({ length: maxLives }, (_, i) => {
                const left = i < lives;
                const x = livesX + (i - (maxLives - 1) / 2) * REALM_CASTLE.livesGap * s;
                const y = cy + (realm ? REALM_CASTLE.livesY : 0.5) * s;
                return (
                  <g key={`${i}-${left ? 'on' : 'off'}`}>
                    <Born
                      className={`life ${left ? 'life-on' : 'life-off'}`}
                      motion={!realm && !left ? 'breaking' : ''}
                      live={settled}
                    >
                      {use('shield', x, y, REALM_CASTLE.life * s)}
                    </Born>
                    {/* Mit Ausbau zerbricht das eben verlorene Schild in zwei Hälften */}
                    {realm && motion?.hit === true && i === lives ? (
                      <ShieldShatter prefix={prefix} x={x} y={y} size={REALM_CASTLE.life * s} />
                    ) : null}
                  </g>
                );
              })}
            </g>
          </>
        ) : null}
        {capital && realm && motion?.placed === true ? (
          // Eben gesetzte Burg: Der Name rückt von der Mitte nach oben, während sie wächst (als
          // Gruppe, wie alles Bewegte auf der Karte)
          <g
            className="name-rise"
            style={{ ['--rise' as string]: `${Math.round((cy - nameAt) * 10) / 10}px` }}
          >
            <text x={cx} y={nameAt} className="board-name">
              {region.name}
            </text>
          </g>
        ) : (
          <text x={cx} y={nameAt} className="board-name">
            {region.name}
          </text>
        )}
        {realm ? (
          <RealmRegionArt
            prefix={prefix}
            region={region}
            owner={owner}
            castle={capital}
            size={s}
            layer={realm}
            live={settled}
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
          <Born key={`coin-${value}`} className="coin" motion="pop" live={settled}>
            <circle cx={coinX} cy={coinY} r={(realm ? 0.17 : 0.2) * s} />
            <text x={coinX} y={coinY + 0.01 * s} className="board-value">
              {formatNumber(value)}
            </text>
          </Born>
        ) : null}
      </g>
    </>
  );
}

/**
 * Bühne eines Duells (docs/ART_DIRECTION.md §4). Vier Bilder nacheinander:
 * `announce` Aufmarsch: Schleier über allem Übrigen, das Wappen des Angreifers stempelt sich in
 * seine Region, der Pfeil zieht sich wie ein Pinselstrich über die Grenze, der Verteidiger stellt
 * sich.
 * `duel` dasselbe als stehendes Bild, solange gefragt wird.
 * `outcome` Ausgang: Der Angreifer holt Schwung, stürmt den Pfeil entlang und schlägt ein (bei
 * `IMPACT_MS`); dann zerspringt der Verteidiger, oder sein Schild wirft den Angreifer zurück,
 * oder der Angreifer prallt von der Burg ab und kehrt heim.
 * `settled` Rest der Auflösung: nur noch der Rand in der Farbe des Siegers.
 * Ohne Animation (laufende Frage, „Bewegung reduzieren“) steht überall das Endbild. Splitter,
 * Funken, Druckwellen und Beben liegen in der Effektebene über der Karte (`duelFx`).
 */
function DuelStageArt({
  prefix,
  art,
  duel,
  source,
  layout,
  castle,
  fallingCastle,
  razed,
  size: s,
  enter,
  ink,
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
  /**
   * Im Ausgang stürzt auf dem Ziel eine Burg ein. Der Sieger setzt sich dann nicht als Siegel
   * darüber: Er prallt am Wall ab und tritt zurück, damit der Einsturz frei vor dem Auge liegt.
   */
  readonly razed: boolean;
  readonly size: number;
  /** Aufmarsch abspielen (nicht beim ersten Aufbau der Seite). */
  readonly enter: boolean;
  /** Klecks der einlaufenden Farbe auf dem Ziel, wenn der Sieger es nimmt (`inkStyle`). */
  readonly ink: CSSProperties | undefined;
}) {
  const target = art.regions[duel.region];
  if (!target) return null;
  const from = source === null ? undefined : art.regions[source];
  // Schleier über das Land mit Löchern für die zwei Regionen des Duells. Das Meer füllt den ganzen
  // Bildschirm und bleibt hell (ADR-059)
  const veil = `${art.coast}${target.d}${from ? from.d : ''}`;
  const outcome = duel.scene === 'outcome';
  const contact = duelContactOf(duel, castle);
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
    ...(layout ? duelMotion(layout, contact, art.size) : {}),
  };
  // Ausgang: erobert, getroffen (Burg oder Gebäude, das Feld bleibt) oder gehalten
  const ending =
    duel.effect === 'CAPITAL_HIT'
      ? ' struck'
      : duel.winner === duel.attacker
        ? ' attack-won'
        : duel.repelled
          ? ' held'
          : '';
  const classes = `duel-stage scene-${duel.scene}${ending} contact-${contact}${razed ? ' razed' : ''}${enter && duel.scene === 'announce' ? ' enter' : ''}`;
  // Hält die Verteidigung, blitzt vor dem Wappen ein goldener Schild auf
  const guard =
    layout && outcome && duel.repelled && duel.defender !== null && !castle
      ? guardArc(layout)
      : null;
  return (
    <g className={classes} style={style} aria-hidden="true">
      <path d={veil} fillRule="evenodd" className="duel-veil" />
      {from && duel.scene !== 'settled' ? <path d={from.d} className="duel-ring source" /> : null}
      {/* Bis der Schlag sitzt, pulst das Ziel noch rot; dann nimmt der Rand die Farbe des Siegers an */}
      {outcome ? <path d={target.d} className="duel-ring target before" /> : null}
      {outcome && ink ? (
        // Nimmt der Sieger die Region, färbt die einlaufende Tinte auch ihren Rand um
        <g className="duel-ring-ink" style={ink}>
          <path d={target.d} className="duel-ring target" />
          <path d={target.d} className="ink-frame" />
        </g>
      ) : (
        <path d={target.d} className="duel-ring target" />
      )}
      {layout && duel.scene !== 'settled' ? (
        <>
          <g transform={`translate(${layout.source.x} ${layout.source.y}) rotate(${layout.angle})`}>
            <g className="duel-arrow">
              {/* Erst beide Umrisse, dann beide Flächen: So bleibt zwischen Schaft und Spitze keine Naht */}
              <g className="arrow-shaft">
                <path d={layout.shaft} className="arrow-outline" />
              </g>
              <g className="arrow-head">
                <path d={layout.head} className="arrow-outline" />
              </g>
              <g className="arrow-shaft">
                <path d={layout.shaft} className="arrow-fill" />
              </g>
              <g className="arrow-head">
                <path d={layout.head} className="arrow-fill" />
              </g>
            </g>
          </g>
          {castle ? (
            // Die Burg einer eingenommenen Hauptstadt ist auf der Karte schon fort: Hier fällt sie
            fallingCastle && outcome && duel.effect === 'TAKEOVER' ? (
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
              guard={guard}
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

const px = (n: number) => `${Math.round(n * 10) / 10}px`;

/**
 * Wege des Ausgangs als Variablen der CSS, in Karteneinheiten (`px` im SVG): Schwung holen
 * (`--back`), Einschlag (`--hit`), Mitte des Ziels (`--into`), zurückgeworfen (`--thrown`).
 * Der Pfeil stößt im eigenen Rahmen nach vorn und wird dabei von hinten zusammengeschoben: Sein
 * Ende bleibt am Rand des stürmenden Wappens (`--arrow-pull`, `--arrow-thrust`, `--arrow-squeeze`).
 */
function duelMotion(layout: DuelLayout, contact: DuelContact, size: number): CSSProperties {
  const { dir, unit, radius: r } = layout;
  const along = (n: number, name: string) => ({
    [`--${name}-x`]: px(dir.x * n),
    [`--${name}-y`]: px(dir.y * n),
  });
  const back = DUEL_BACK * unit;
  const hit = duelContact(layout, contact, size);
  const front = hit + r;
  // Vor dem Verteidiger fährt die Spitze unter sein Wappen; sonst bleibt sie am stürmenden Wappen
  const tipAt = contact === 'token' ? layout.distance - 0.15 * unit : front + 0.04 * unit;
  const length = layout.tip - layout.start;
  // Beim Ausholen bleibt das Ende des Pfeils am Wappen
  const pull = back + r - layout.start;
  return {
    ['--ux' as string]: dir.x.toFixed(3),
    ['--uy' as string]: dir.y.toFixed(3),
    ['--unit' as string]: px(unit),
    ['--ang' as string]: `${layout.angle}deg`,
    ...along(back, 'back'),
    ...along(hit, 'hit'),
    ...along(-0.3 * unit, 'thrown'),
    ...along(hit - 0.2 * unit, 'recoil'),
    ['--into-x' as string]: px(layout.target.x - layout.source.x),
    ['--into-y' as string]: px(layout.target.y - layout.source.y),
    ['--arrow-pull' as string]: px(pull),
    ['--arrow-thrust' as string]: px(tipAt - layout.tip),
    ['--arrow-squeeze' as string]: Math.max(0.04, (tipAt - front) / length).toFixed(3),
  };
}

/**
 * Goldener Schild vor dem Verteidiger: ein Bogen um sein Wappen, zum Angreifer hin. Dazu ein
 * unsichtbarer Kreis, damit die Gruppe um die Mitte des Wappens wächst (`transform-box: fill-box`).
 */
function guardArc(layout: DuelLayout): { readonly arc: string; readonly r: number } {
  const r = DUEL_GUARD * layout.radius;
  const facing = Math.atan2(-layout.dir.y, -layout.dir.x);
  const open = (62 * Math.PI) / 180;
  const at = (angle: number) =>
    `${Math.round((layout.target.x + r * Math.cos(angle)) * 10) / 10} ${Math.round((layout.target.y + r * Math.sin(angle)) * 10) / 10}`;
  return { arc: `M${at(facing - open)}A${r} ${r} 0 0 1 ${at(facing + open)}`, r };
}

/**
 * Wappenplättchen eines Sitzes auf der Karte: helle Scheibe mit Rand in der Sitzfarbe, darauf
 * Schild und Wappenbild. Die Gruppen sind verschachtelt, weil jede Bewegung ihre eigene braucht:
 * Weg im Ausgang, Stoß im Takt, Größe, Stauchen in Laufrichtung. Daneben stehen der Tintenring
 * des Aufmarschs, der goldene Ring des Siegers und der goldene Schild einer Abwehr; ohne Bewegung
 * sind sie unsichtbar.
 */
function DuelToken({
  prefix,
  role,
  seat,
  x,
  y,
  r,
  guard = null,
}: {
  readonly prefix: string;
  readonly role: 'attacker' | 'defender';
  readonly seat: number;
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly guard?: { readonly arc: string; readonly r: number } | null;
}) {
  const shield = r * 1.3;
  const emblem = r * 0.52;
  return (
    <g className={`duel-token ${role} seat-${seat}`}>
      <g className="token-nudge">
        <circle cx={x} cy={y} r={r * 1.08} className="token-stamp" />
        <g className="token-body">
          <g className="token-squash">
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
            <circle cx={x} cy={y} r={r * 1.02} className="token-flash" />
          </g>
        </g>
        <g className="token-seal">
          <circle cx={x} cy={y} r={r * 1.22} className="seal-glow" />
          <circle cx={x} cy={y} r={r * 1.22} className="seal-ring" />
        </g>
        {guard ? (
          <g className="token-guard">
            <circle cx={x} cy={y} r={guard.r} className="guard-room" />
            <path d={guard.arc} className="guard-glow" />
            <path d={guard.arc} className="guard-arc" />
          </g>
        ) : null}
      </g>
    </g>
  );
}
