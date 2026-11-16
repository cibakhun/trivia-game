import type { MatchMode, MatchRecord, MeResponse } from '@rdw/protocol';
import { useEffect, useId, useState, type ReactNode } from 'react';
import {
  onSoundChange,
  playSound,
  setSoundEnabled,
  soundEnabled,
  unlockAudio,
} from '../audio/sound.ts';
import { ArtDefs, symbolRef } from '../art/ArtDefs.tsx';
import { Emblem } from '../art/Emblem.tsx';
import { Icon, type IconKind } from '../art/Icons.tsx';
import { MenuMap } from '../art/MenuMap.tsx';
import { t } from '../i18n/i18n.ts';
import { navigate } from '../router.ts';
import { initialOf, playerName, recordLine } from './menu-text.ts';

/**
 * Bausteine des Hauptmenüs (ADR-074): Siegel, Plakette, Werkzeuge, Kopf eines Blatts, Schalter,
 * Leisten zur Wahl und die Bildkarten der Spielart. Maße und Bewegung stehen in `menu.css`.
 */

/** Rand eines Siegels: 28 Zacken wie gepresstes Wachs. */
const SEAL_EDGE = (() => {
  const points: string[] = [];
  const n = 28;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = i % 2 ? 44 : 48;
    points.push(`${(Math.sin(a) * r).toFixed(1)} ${(-Math.cos(a) * r).toFixed(1)}`);
  }
  return `M${points.join('L')}Z`;
})();

export function Seal({
  icon,
  label,
  big = false,
  onClick,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly big?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button type="button" className={`menu-seal${big ? ' big' : ''}`} onClick={onClick}>
      <span className="menu-seal-disc" aria-hidden="true">
        <svg className="menu-seal-edge" viewBox="-50 -50 100 100" focusable="false">
          <path d={SEAL_EDGE} />
        </svg>
        <span className="menu-seal-icon">{icon}</span>
      </span>
      <span className="menu-seal-label">{label}</span>
    </button>
  );
}

/** Name des Spiels als schmale Leiste oben in der Mitte: klein, damit die Karte frei bleibt. */
export function TitleMark() {
  return (
    <h1 className="menu-mark">
      <Emblem size={20} />
      <span>{t('app.title')}</span>
    </h1>
  );
}

/** Wappen mit Anfangsbuchstabe. */
function Crest({ letter }: { readonly letter: string }) {
  return (
    <svg className="menu-crest" viewBox="-50 -52 100 104" aria-hidden="true" focusable="false">
      <path d="M-42-46H42V-4C42 24 18 40 0 50C-18 40-42 24-42-4Z" strokeWidth="6" />
      <path
        d="M-33-37H33V-5C33 18 14 31 0 39C-14 31-33 18-33-5Z"
        className="inner"
        strokeWidth="2.5"
      />
      <text x="0" y="0" textAnchor="middle" dominantBaseline="central">
        {letter}
      </text>
    </svg>
  );
}

/** Plakette oben links: Wappen, Name und Bilanz; ein Tipp öffnet das Konto (Gäste: Konto sichern). */
export function PlayerPlate({
  me,
  record,
}: {
  readonly me: MeResponse;
  readonly record: MatchRecord | null;
}) {
  const name = playerName(me);
  // Wer schon gespielt hat, sieht seine Bilanz; ein Gast ohne Partie liest, dass er sein Konto
  // sichern kann
  const played = record !== null && record.played > 0;
  const secure = me.user.isGuest && !played;
  const sub = played
    ? recordLine(record)
    : secure
      ? t('menu.plate.secure')
      : record === null
        ? ''
        : t('menu.plate.noMatches');
  return (
    <button
      type="button"
      className="menu-plate"
      aria-label={t('menu.plate.account', { name })}
      data-testid="menu-plate"
      onClick={() => navigate({ name: 'account' })}
    >
      <Crest letter={initialOf(name)} />
      <span className="menu-plate-text">
        <span className="menu-plate-name">{name}</span>
        {sub ? <span className={`menu-plate-sub${secure ? ' secure' : ''}`}>{sub}</span> : null}
      </span>
    </button>
  );
}

/** Runder Knopf mit Zeichen, ohne Text daneben. */
export function RoundButton({
  icon,
  label,
  pressed,
  onClick,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly pressed?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="menu-round"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

export function MenuIcon({ kind }: { readonly kind: IconKind }) {
  return <Icon kind={kind} size={24} />;
}

/** Ton an und aus wie in der Partie; der Zustand bleibt im Browser gespeichert. */
export function SoundButton() {
  const [on, setOn] = useState(soundEnabled);
  useEffect(() => onSoundChange(setOn), []);
  return (
    <RoundButton
      label={on ? t('sound.turnOff') : t('sound.turnOn')}
      pressed={on}
      onClick={() => {
        unlockAudio();
        setSoundEnabled(!on);
        if (!on) playSound('pick');
      }}
      icon={
        <svg className="menu-speaker" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M4 9h4l5-4v14l-5-4H4z" className="speaker" />
          {on ? (
            <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" className="waves" />
          ) : (
            <path d="M16 9l5 6M21 9l-5 6" className="waves" />
          )}
        </svg>
      }
    />
  );
}

/** Kopf eines Blatts: zurück zum Hauptmenü und Titel. */
export function SheetHead({
  id,
  title,
  onBack,
}: {
  readonly id: string;
  readonly title: string;
  readonly onBack?: (() => void) | undefined;
}) {
  return (
    <header className="menu-sheet-head">
      {onBack ? (
        <RoundButton icon={<MenuIcon kind="back" />} label={t('menu.back')} onClick={onBack} />
      ) : null}
      <h2 id={id} tabIndex={-1}>
        {title}
      </h2>
    </header>
  );
}

/** Schalter mit Text: ein Kontrollkästchen, das wie ein Schieber aussieht. */
export function Toggle({
  label,
  checked,
  onChange,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <label className="menu-toggle">
      <input
        type="checkbox"
        className="menu-toggle-input"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="menu-switch" aria-hidden="true">
        <span />
      </span>
      <span>{label}</span>
    </label>
  );
}

/** Leiste zur Wahl: Optionsfelder, die wie zusammenhängende Knöpfe aussehen. */
export function Segmented<T extends string | number>({
  label,
  name,
  options,
  value,
  onChange,
  labelIcon,
}: {
  readonly label: string;
  readonly name: string;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly labelIcon?: ReactNode;
}) {
  const id = useId();
  return (
    <>
      <span className="menu-form-label" id={id}>
        {labelIcon}
        {label}
      </span>
      <span className="menu-seg" role="radiogroup" aria-labelledby={id}>
        {options.map((option) => (
          <label key={String(option.value)} className={option.value === value ? 'on' : undefined}>
            <input
              type="radio"
              className="menu-pick"
              name={name}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </span>
    </>
  );
}

/** Ausschnitt der Karte für die Bildkarten der Spielart. */
const CROP = '196 166 336 128';

/** Kleine Kartenszene zur Spielart: Hauptstadt mit Leben und Angriff, oder Burgen, Dörfer, Armee und Glücksrad. */
function ModeArt({ mode }: { readonly mode: MatchMode }) {
  const prefix = `mode${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <span className="menu-mode-art" aria-hidden="true">
      <MenuMap viewBox={CROP} life={false} />
      <svg className="map-art menu-mode-over" viewBox={CROP} focusable="false">
        <ArtDefs prefix={prefix} />
        {mode === 'CLASSIC' ? (
          <>
            <path d="M296 236Q366 196 432 232" className="arrow" />
            <path d="M416 216L434 233L412 244" className="arrow" />
            <g style={{ ['--flag' as string]: 'var(--seat-0)' }}>
              <use href={symbolRef(prefix, 'castle')} x="226" y="200" width="72" height="72" />
            </g>
            <g style={{ ['--flag' as string]: 'var(--seat-1)' }}>
              <use href={symbolRef(prefix, 'castle')} x="440" y="206" width="66" height="66" />
            </g>
            <g className="lives" transform="translate(240 274)">
              {[0, 1, 2].map((i) => (
                <path
                  key={i}
                  transform={`translate(${i * 19} 0)`}
                  d="M0 0H15V9C15 16 7.5 20 7.5 20C7.5 20 0 16 0 9Z"
                />
              ))}
            </g>
          </>
        ) : (
          <>
            <g style={{ ['--flag' as string]: 'var(--seat-0)' }}>
              <use href={symbolRef(prefix, 'castle')} x="222" y="200" width="68" height="68" />
              <use href={symbolRef(prefix, 'village')} x="282" y="166" width="44" height="46" />
              <use href={symbolRef(prefix, 'town')} x="300" y="244" width="48" height="48" />
            </g>
            <g style={{ ['--flag' as string]: 'var(--seat-1)' }}>
              <use href={symbolRef(prefix, 'castle')} x="440" y="206" width="62" height="62" />
              <use href={symbolRef(prefix, 'village')} x="494" y="168" width="40" height="42" />
            </g>
            <g className="army" transform="translate(360 212)">
              <path d="M0 40V-4" />
              <path d="M0 -4H26L19 7L26 18H0Z" className="cloth" />
              <circle cx="13" cy="34" r="10" className="coin" />
              <text x="13" y="35" className="n">
                3
              </text>
            </g>
            <g transform="translate(398 206)" className="wheel">
              <circle r="27" className="rim" />
              {[0, 60, 120, 180, 240, 300].map((a, i) => (
                <path
                  key={a}
                  d="M0 0L0 -23A23 23 0 0 1 19.92 -11.5Z"
                  transform={`rotate(${a})`}
                  className={i % 2 ? 'free' : 'mine'}
                />
              ))}
              <circle r="4.5" className="hub" />
              <path d="M-6 -35L6 -35L0 -22Z" className="ptr" />
            </g>
          </>
        )}
      </svg>
    </span>
  );
}

/** Wahl der Spielart als zwei Bildkarten mit echtem Kartenausschnitt. */
export function ModeChoice({
  value,
  onChange,
}: {
  readonly value: MatchMode;
  readonly onChange: (mode: MatchMode) => void;
}) {
  const name = useId();
  return (
    <fieldset className="menu-modes" data-testid="match-mode">
      <legend className="visually-hidden">{t('realm.hub.modeLegend')}</legend>
      {(['CLASSIC', 'REALM'] as const).map((mode) => {
        const on = mode === value;
        return (
          <label key={mode} className={`menu-mode${on ? ' on' : ''}`}>
            <input
              type="radio"
              className="menu-pick"
              name={name}
              value={mode}
              checked={on}
              onChange={() => onChange(mode)}
            />
            <span className="menu-mode-title">{t(`realm.hub.${mode}`)}</span>
            <span className="menu-mode-sub">
              {t(mode === 'CLASSIC' ? 'realm.hub.classicText' : 'realm.hub.realmText')}
            </span>
            <ModeArt mode={mode} />
            {on ? (
              <span className="menu-mode-check" aria-hidden="true">
                <svg viewBox="-20 -20 40 40" focusable="false">
                  <circle r="16" />
                  <path d="M-8 0L-2 6L9-6" />
                </svg>
              </span>
            ) : null}
          </label>
        );
      })}
    </fieldset>
  );
}
