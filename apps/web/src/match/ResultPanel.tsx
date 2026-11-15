import type { MatchEventOf, MatchView } from '@rdw/protocol';
import { DEFAULT_MATCH_RULES } from '@rdw/protocol';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import '../art/fx/fx.css';
import { LifeShields } from '../art/LifeShields.tsx';
import { SeatCrest } from '../art/SeatCrest.tsx';
import { formatNumber, t, tp } from '../i18n/i18n.ts';
import { navigate } from '../router.ts';
import type { SeatName } from './match-text.ts';
import {
  resultTiming,
  SEAL_GLINTS,
  SEAL_SIZE,
  sealSparks,
  TALLY_LEAD_MS,
  tallyAt,
  type ResultTone,
} from './result-motion.ts';

/**
 * Abrechnung (MATCH_RULES §6) als Blatt auf der Karte: Platz, Punkte, Regionen und
 * Hauptstadtleben je Sitz, daneben das Ergebnis und wie es weitergeht. Mit Ausbau (§11.8) stehen
 * statt der Hauptstadt die Leben aller Burgen des Reichs da.
 *
 * Hat die Seite das Ende miterlebt (`live`), baut sich das Blatt im Takt des Klangs auf
 * (`result-motion.ts`, docs/ART_DIRECTION.md §5): beim Sieg die Tabelle vom letzten Platz zum
 * ersten, dann setzt der Lorbeer mit Krone wie ein Siegel auf; sonst füllt sie sich ruhig von
 * oben. Wer in die fertige Partie lädt, sieht gleich das Endbild. Die Knöpfe stehen von Anfang an.
 */

interface Standing {
  readonly seat: number;
  readonly place: number;
  readonly points: number;
  readonly regions: number;
  readonly lives: number;
  readonly eliminated: boolean;
}

function byPoints(seats: readonly Omit<Standing, 'place'>[]): Standing[] {
  return [...seats]
    .sort((a, b) => b.points - a.points)
    .map((s, i) => ({
      seat: s.seat,
      place: i + 1,
      points: s.points,
      regions: s.regions,
      lives: s.lives,
      eliminated: s.eliminated,
    }));
}

/** „Bewegung reduzieren“ im System: Dann steht das Endbild sofort. */
function prefersStill(): boolean {
  return (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

const ms = (n: number) => `${Math.round(n)}ms`;
/** Länge in Einheiten der Bühne. */
const u = (n: number) => `calc(${Math.round(n * 100) / 100} * var(--u))`;

export function ResultPanel({
  view,
  finished,
  name,
  live = false,
}: {
  readonly view: MatchView;
  readonly finished: MatchEventOf<'MATCH_FINISHED'> | MatchEventOf<'REALM_MATCH_FINISHED'> | null;
  readonly name: SeatName;
  /** Die Seite hat das Ende miterlebt: Nur dann baut sich das Blatt auf. */
  readonly live?: boolean;
}) {
  // Steht beim Erscheinen fest: Ein späteres Rendern stößt nichts neu an
  const [entrance] = useState(() => live && !prefersStill());
  // Mit Ausbau zählt jedes Reich die Leben all seiner Burgen
  const realm = view.realm?.board ?? null;
  // Ohne das Ereignis (etwa nicht mehr im Speicher) zählt der Stand der Karte
  const standings: readonly Standing[] =
    finished?.type === 'MATCH_FINISHED'
      ? finished.payload.standings.map((s) => ({ ...s, lives: s.capitalLives }))
      : finished?.type === 'REALM_MATCH_FINISHED'
        ? finished.payload.standings.map((s) => ({ ...s, lives: s.castleLives }))
        : byPoints(
            realm
              ? realm.seats.map((s) => ({ ...s, lives: s.castleLivesLeft }))
              : (view.board?.seats ?? []).map((s) => ({ ...s, lives: s.capitalLivesLeft })),
          );
  const maxLives = Math.max(DEFAULT_MATCH_RULES.capital.lives, ...standings.map((s) => s.lives));
  const mine = standings.find((s) => s.seat === view.mySeat);
  const shared = mine?.place === 1 && standings.filter((s) => s.place === 1).length > 1;
  const tone: ResultTone = mine ? (mine.place === 1 ? 'victory' : 'placed') : 'neutral';
  const headline =
    mine?.place === 1
      ? shared
        ? t('match.result.sharedWin')
        : t('match.result.won')
      : mine
        ? t('match.result.place', { place: mine.place })
        : t('match.result.title');
  const places = standings.map((s) => s.place).join(',');
  const timing = useMemo(
    () => resultTiming(places === '' ? [] : places.split(',').map(Number), tone),
    [places, tone],
  );
  const style =
    entrance && timing.seal !== null
      ? ({ ['--seal-at' as string]: ms(timing.seal) } as CSSProperties)
      : undefined;

  return (
    <section
      className={`sheet resolution result ${tone}${entrance ? ' entrance' : ''}`}
      style={style}
      aria-labelledby="result-title"
      data-testid="match-result"
    >
      {tone === 'victory' ? (
        <Seal sealAt={entrance ? timing.seal : null} />
      ) : mine ? (
        <PlaceCrest seat={mine.seat} place={mine.place} />
      ) : null}
      <h1 id="result-title" className={tone === 'victory' ? 'won' : ''} data-text={headline}>
        {headline}
      </h1>
      {finished ? <p>{t(`match.result.reason.${finished.payload.reason}`)}</p> : null}
      <div className="table-wrap">
        <table className="sides">
          <thead>
            <tr>
              <th scope="col">{t('match.result.placeColumn')}</th>
              <th scope="col">{t('match.reveal.player')}</th>
              <th scope="col">{t('match.result.pointsColumn')}</th>
              <th scope="col">{t('match.result.regionsColumn')}</th>
              <th scope="col">
                {realm ? t('realm.result.livesColumn') : t('match.result.livesColumn')}
              </th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s, row) => {
              const at = entrance ? (timing.rows[row] ?? null) : null;
              return (
                <tr
                  key={s.seat}
                  data-seat={s.seat}
                  className={`seat-${s.seat} place-${s.place}${s.seat === view.mySeat ? ' me' : ''}${s.eliminated ? ' out' : ''}`}
                  style={at === null ? undefined : { ['--at' as string]: ms(at) }}
                >
                  <td>
                    <span className="place">{s.place}.</span>
                  </td>
                  <th scope="row">
                    <span className="who">
                      <SeatCrest seat={s.seat} size={24} />
                      {name(s.seat)}
                    </span>
                  </th>
                  <td>
                    <Tally
                      value={s.points}
                      startMs={at === null ? null : at - TALLY_LEAD_MS}
                      durationMs={timing.counts[row] ?? 0}
                    />
                  </td>
                  <td>
                    <span className="cell">{formatNumber(s.regions)}</span>
                  </td>
                  <td>
                    <LifeShields
                      left={s.eliminated ? 0 : s.lives}
                      max={maxLives}
                      label={
                        s.eliminated
                          ? t('match.result.eliminated')
                          : realm
                            ? tp('realm.seats.castleLives', s.lives)
                            : tp('match.board.lives', s.lives)
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {view.match.kind === 'TEST' ? (
        <p className="muted">{t('match.result.test')}</p>
      ) : view.players.some((p) => p.isBot) ? (
        <p className="muted">{t('match.result.bots')}</p>
      ) : null}
      <div className="actions">
        <button
          type="button"
          className="button button-primary"
          onClick={() => navigate({ name: 'matches' })}
        >
          {t('match.result.again')}
        </button>
        <button type="button" className="button" onClick={() => navigate({ name: 'start' })}>
          {t('match.hub.back')}
        </button>
      </div>
    </section>
  );
}

/**
 * Punkte einer Zeile: Mit `startMs` zählen sie ab dann von 0 hoch. Die Endzahl steht dabei
 * unsichtbar an ihrem Platz und hält die Breite der Spalte; Vorleser hören nur sie.
 */
function Tally({
  value,
  startMs,
  durationMs,
}: {
  readonly value: number;
  readonly startMs: number | null;
  readonly durationMs: number;
}) {
  const counts = startMs !== null && value > 0 && durationMs > 0;
  const [shown, setShown] = useState<number | null>(counts ? 0 : null);
  // Gezählt wird ab dem Erscheinen, auch wenn später neu gerendert wird
  const origin = useRef<number | null>(null);

  useEffect(() => {
    if (!counts) {
      setShown(null);
      return;
    }
    origin.current ??= performance.now();
    const began = origin.current + startMs;
    let frame = 0;
    const tick = (now: number) => {
      const next = now < began ? 0 : tallyAt(now - began, durationMs, value);
      setShown(next);
      if (next !== null) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [counts, value, startMs, durationMs]);

  return (
    <span className="tally">
      <span className={shown === null ? undefined : 'tally-end'}>{formatNumber(value)}</span>
      {shown === null ? null : (
        <span className="tally-run" aria-hidden="true">
          {formatNumber(shown)}
        </span>
      )}
    </span>
  );
}

/** Eigenes Wappen mit der Plakette des Platzes: das ruhige Gegenstück zum Siegel. */
function PlaceCrest({ seat, place }: { readonly seat: number; readonly place: number }) {
  return (
    <div className={`result-crest place-${place}`} aria-hidden="true">
      <SeatCrest seat={seat} size={46} />
      <span className="place">{place}.</span>
    </div>
  );
}

// ---- Siegel: Lorbeerkranz mit Krone vor einem Strahlenkranz (eigene Zeichnung) ----

/** Punkt und Richtung auf dem Stiel des linken Zweigs (kubische Kurve von unten nach oben). */
const STEM = [
  [-5, 37],
  [-30, 33],
  [-47, 12],
  [-41, -16],
] as const;

function stemAt(at: number): { x: number; y: number; angle: number } {
  const [a, b, c, d] = STEM;
  const m = 1 - at;
  const point = (i: 0 | 1) =>
    m ** 3 * a[i] + 3 * m * m * at * b[i] + 3 * m * at * at * c[i] + at ** 3 * d[i];
  const slope = (i: 0 | 1) =>
    3 * m * m * (b[i] - a[i]) + 6 * m * at * (c[i] - b[i]) + 3 * at * at * (d[i] - c[i]);
  return { x: point(0), y: point(1), angle: (Math.atan2(slope(1), slope(0)) * 180) / Math.PI };
}

interface Leaf {
  readonly key: string;
  readonly transform: string;
  readonly inner: boolean;
}

/** Blätter paarweise am Stiel, nach außen und innen gespreizt, zur Spitze hin kleiner. */
const LEAVES: readonly Leaf[] = [0.1, 0.24, 0.38, 0.52, 0.66, 0.8, 0.92].flatMap((at, i) => {
  const { x, y, angle } = stemAt(at);
  const scale = 1 - i * 0.035;
  const leaf = (inner: boolean): Leaf => ({
    key: `${i}-${inner ? 'i' : 'o'}`,
    transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(angle + (inner ? 36 : -36)).toFixed(0)}) scale(${scale.toFixed(2)})`,
    inner,
  });
  return [leaf(true), leaf(false)];
});
const TIP = stemAt(1);

function Seal({ sealAt }: { readonly sealAt: number | null }) {
  return (
    <div className="result-seal" aria-hidden="true">
      <svg className="seal-rays" viewBox="-60 -60 120 120" focusable="false">
        <defs>
          <radialGradient id="seal-ray-fade" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="58">
            <stop offset="0.25" className="seal-ray-in" />
            <stop offset="1" className="seal-ray-out" />
          </radialGradient>
        </defs>
        {Array.from({ length: 16 }, (_, i) => (
          <path
            key={i}
            d={i % 2 === 0 ? 'M0 0L-3.6-58H3.6Z' : 'M0 0L-2.4-45H2.4Z'}
            transform={`rotate(${i * 22.5})`}
            fill="url(#seal-ray-fade)"
          />
        ))}
      </svg>
      <span className="seal-shadow" />
      {sealAt === null ? null : <SealFx at={sealAt} layer="under" />}
      <svg className="seal-body" viewBox="-60 -52 120 96" focusable="false">
        <defs>
          <linearGradient id="seal-gold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f8df92" />
            <stop offset="0.55" stopColor="#dcaa42" />
            <stop offset="1" stopColor="#b9862c" />
          </linearGradient>
        </defs>
        {[-1, 1].map((side) => (
          <g key={side} transform={`scale(${side} 1)`}>
            <path
              d={`M${STEM[0].join(' ')}C${STEM[1].join(' ')} ${STEM[2].join(' ')} ${STEM[3].join(' ')}`}
              className="seal-stem"
            />
            {LEAVES.map((leaf) => (
              <g key={leaf.key} transform={leaf.transform}>
                <path
                  d="M0 0C3.5-4.3 9.5-4.7 14.5 0C9.5 4.7 3.5 4.3 0 0Z"
                  className={leaf.inner ? 'seal-leaf seal-leaf-inner' : 'seal-leaf'}
                />
                <path d="M2 0H11" className="seal-rib" />
              </g>
            ))}
            <g
              transform={`translate(${TIP.x.toFixed(1)} ${TIP.y.toFixed(1)}) rotate(${TIP.angle.toFixed(0)}) scale(0.78)`}
            >
              <path d="M0 0C3.5-4.3 9.5-4.7 14.5 0C9.5 4.7 3.5 4.3 0 0Z" className="seal-leaf" />
              <path d="M2 0H11" className="seal-rib" />
            </g>
          </g>
        ))}
        <path d="M-3.5 37.5L-9 45.5L-4.5 43.5L-2.5 46.5L0 39Z" className="seal-ribbon" />
        <path d="M3.5 37.5L9 45.5L4.5 43.5L2.5 46.5L0 39Z" className="seal-ribbon" />
        <ellipse cx="0" cy="37" rx="5.2" ry="3.4" className="seal-knot" />
        <path
          d="M-19 1L-25.5-21L-12-10.5L0-28.5L12-10.5L25.5-21L19 1Z"
          className="seal-crown"
          strokeLinejoin="round"
        />
        <path d="M-16.5-3L-21-16.5L-12.5-9.5M-3.5-12.5L0-18" className="seal-crown-light" />
        <rect x="-19.5" y="-0.5" width="39" height="8" rx="2.2" className="seal-band" />
        <path d="M-16.5 1.6H16.5" className="seal-crown-light" />
        <circle cx="-25.5" cy="-22.5" r="2.9" className="seal-pearl" />
        <circle cx="25.5" cy="-22.5" r="2.9" className="seal-pearl" />
        <circle cx="-10.5" cy="3.5" r="1.7" className="seal-pearl" />
        <circle cx="10.5" cy="3.5" r="1.7" className="seal-pearl" />
        <circle cx="0" cy="-30.5" r="3.8" className="seal-gem" />
        <circle cx="0" cy="3.5" r="2.3" className="seal-gem" />
        <path d="M-1.6-32.2A2.4 2.4 0 0 1 1-32.6" className="seal-gem-light" />
      </svg>
      {sealAt === null ? null : <SealFx at={sealAt} layer="over" />}
    </div>
  );
}

type FxStyle = Readonly<Record<string, string>>;

/** Ein Teilchen der Effektebene (`art/fx/fx.css`) im Blatt: Klasse der Art, Variablen als Stil. */
function fxSpan(key: string, kind: string, style: FxStyle) {
  return (
    <span key={key} className={`fx-p fx-${kind}`} style={style}>
      <b />
    </span>
  );
}

/**
 * Was beim Aufsetzen des Siegels geschieht, in zwei Lagen: darunter ein Schein, eine Druckwelle in
 * Tinte und ein Ring in Gold; darüber Funken und Glanzpunkte. Es sind die
 * Teilchen der Effektebene der Karte (`art/fx`), hier im Blatt und in Einheiten der Bühne; ohne
 * Animation ist jedes unsichtbar.
 */
function SealFx({ at, layer }: { readonly at: number; readonly layer: 'under' | 'over' }) {
  const sparks = useMemo(() => sealSparks(at), [at]);
  if (layer === 'under') {
    return (
      <span className="seal-fx seal-fx-under">
        <span className="seal-flash" />
        {fxSpan('ink', 'ring seal-ring-ink', {
          '--s': u(SEAL_SIZE),
          '--d': ms(at),
          '--t': ms(460),
        })}
        {fxSpan('gold', 'ring seal-ring-gold', {
          '--s': u(SEAL_SIZE * 0.9),
          '--d': ms(at + 60),
          '--t': ms(640),
        })}
      </span>
    );
  }
  return (
    <span className="seal-fx seal-fx-over">
      {sparks.map((p) =>
        fxSpan(p.key, 'sparks', {
          '--s': u(p.size),
          '--dx': u(p.dx),
          '--rot': `${p.rot}deg`,
          '--d': ms(p.delayMs),
          '--t': ms(p.durationMs),
        }),
      )}
      {SEAL_GLINTS.map((g, i) =>
        fxSpan(`glint-${i}`, 'glints', {
          left: `${(((g.x + 60) / 120) * 100).toFixed(1)}%`,
          top: `${(((g.y + 52) / 96) * 100).toFixed(1)}%`,
          '--s': u(g.size),
          '--rot': `${g.rot}deg`,
          '--d': ms(at + g.afterMs),
          '--t': ms(g.durationMs),
        }),
      )}
    </span>
  );
}
