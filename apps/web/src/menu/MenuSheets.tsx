import {
  MATCH_BOT_STRENGTH_CODES,
  type MatchBotStrengthCode,
  type MatchCreateRequest,
  type MatchListResponse,
  type MatchMode,
} from '@rdw/protocol';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Icon } from '../art/Icons.tsx';
import { SeatCrest } from '../art/SeatCrest.tsx';
import { LoginForm } from '../components/AccountForms.tsx';
import { ErrorNote } from '../components/ErrorNote.tsx';
import { formatNumber, t, tp } from '../i18n/i18n.ts';
import { navigate } from '../router.ts';
import { useSession } from '../session.tsx';
import { MenuIcon, ModeChoice, Segmented, SheetHead, Toggle } from './MenuParts.tsx';
import {
  chronicleDetail,
  hitRate,
  isOpenMatch,
  modeText,
  placeText,
  whenText,
  type MatchSummary,
} from './menu-text.ts';

/**
 * Blätter des Hauptmenüs (ADR-074): Neue Partie, Mit Code beitreten, Übungspartie, Chronik, dazu
 * Willkommen und Anmelden ohne Sitzung. Jedes liegt in der Mitte der Bühne über der Karte.
 */

/** Rahmen eines Blatts: Kopf mit Zurück und Titel; der Fokus springt beim Öffnen auf den Titel. */
export function SheetFrame({
  title,
  sub,
  onBack,
  className,
  testId,
  children,
}: {
  readonly title: string;
  readonly sub?: string | undefined;
  readonly onBack?: (() => void) | undefined;
  readonly className?: string;
  readonly testId?: string;
  readonly children: ReactNode;
}) {
  const id = useId();
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    const root = section.current;
    if (!root || root.contains(document.activeElement)) return;
    root.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
  }, []);
  return (
    <section
      ref={section}
      className={`sheet menu-sheet${className ? ` ${className}` : ''}`}
      aria-labelledby={id}
      data-testid={testId}
    >
      <SheetHead id={id} title={title} onBack={onBack} />
      {sub ? <p className="menu-note menu-sheet-sub">{sub}</p> : null}
      {children}
    </section>
  );
}

/** Statt eines Formulars, solange eine eigene Partie offen ist: Jedes Konto spielt nur eine. */
function OpenNotice({ match }: { readonly match: MatchSummary }) {
  return (
    <div className="menu-open-notice">
      <p className="menu-note">{t('menu.open.note')}</p>
      <button
        type="button"
        className="button button-primary menu-go"
        onClick={() => navigate({ name: 'match', matchId: match.id })}
      >
        {t(`menu.open.${match.status === 'LOBBY' ? 'LOBBY' : 'RUNNING'}_go`)}
      </button>
    </div>
  );
}

interface CreateProps {
  readonly list: MatchListResponse;
  readonly mode: MatchMode;
  readonly onMode: (mode: MatchMode) => void;
  readonly busy: boolean;
  readonly error: unknown;
  readonly onCreate: (body: MatchCreateRequest) => void;
  readonly onBack: () => void;
}

function openOf(list: MatchListResponse): MatchSummary | null {
  return list.matches.find(isOpenMatch) ?? null;
}

/** Neue Partie: Spielart als Bildkarten, kurze Zeiten für Spieltests, Eröffnen. */
export function NewSheet({ list, mode, onMode, busy, error, onCreate, onBack }: CreateProps) {
  const [short, setShort] = useState(false);
  const open = openOf(list);
  return (
    <SheetFrame
      title={t('menu.new.title')}
      sub={open ? undefined : t('menu.new.text')}
      onBack={onBack}
      className={`menu-new${list.realmMatchesEnabled ? '' : ' single'}`}
      testId="menu-new"
    >
      {open ? (
        <OpenNotice match={open} />
      ) : (
        <>
          {list.realmMatchesEnabled ? <ModeChoice value={mode} onChange={onMode} /> : null}
          {error ? <ErrorNote error={error} /> : null}
          <div className="menu-sheet-foot">
            <Toggle label={t('menu.new.shortTimers')} checked={short} onChange={setShort} />
            <button
              type="button"
              className="button button-primary menu-go"
              disabled={busy}
              onClick={() =>
                onCreate({
                  kind: 'STANDARD',
                  rules: short ? 'PLAYTEST' : 'DEFAULT',
                  mode: list.realmMatchesEnabled ? mode : 'CLASSIC',
                })
              }
            >
              {t('menu.new.create')}
            </button>
          </div>
        </>
      )}
    </SheetFrame>
  );
}

/** Übungspartie gegen Bots (ADR-048): Spielart, Plätze, Stärke jedes Bots, kurze Zeiten. */
export function PracticeSheet({ list, mode, onMode, busy, error, onCreate, onBack }: CreateProps) {
  const [seats, setSeats] = useState<2 | 3>(3);
  const [bots, setBots] = useState<MatchBotStrengthCode[]>(['MEDIUM', 'MEDIUM']);
  const [short, setShort] = useState(false);
  const open = openOf(list);
  const name = useId();
  return (
    <SheetFrame
      title={t('menu.practice.title')}
      sub={open ? undefined : t('menu.practice.text')}
      onBack={onBack}
      className="menu-practice"
      testId="test-match"
    >
      {open ? (
        <OpenNotice match={open} />
      ) : (
        <>
          <div className="menu-form">
            {list.realmMatchesEnabled ? (
              <Segmented
                label={t('menu.practice.mode')}
                name={`${name}-mode`}
                value={mode}
                onChange={onMode}
                options={(['CLASSIC', 'REALM'] as const).map((value) => ({
                  value,
                  label: t(`realm.hub.${value}`),
                }))}
              />
            ) : null}
            <Segmented
              label={t('menu.practice.seats')}
              name={`${name}-seats`}
              value={seats}
              onChange={setSeats}
              options={[
                { value: 2 as const, label: t('menu.practice.seats2') },
                { value: 3 as const, label: t('menu.practice.seats3') },
              ]}
            />
            {bots.slice(0, seats - 1).map((strength, i) => (
              <Segmented
                key={i}
                label={t('menu.practice.bot', { n: i + 1 })}
                labelIcon={<SeatCrest seat={i + 1} size={16} />}
                name={`${name}-bot-${i}`}
                value={strength}
                onChange={(value) =>
                  setBots((current) => current.map((s, j) => (j === i ? value : s)))
                }
                options={MATCH_BOT_STRENGTH_CODES.map((level) => ({
                  value: level,
                  label: t(`match.bot.${level}`),
                }))}
              />
            ))}
          </div>
          {error ? <ErrorNote error={error} /> : null}
          <div className="menu-sheet-foot">
            <Toggle label={t('menu.new.shortTimers')} checked={short} onChange={setShort} />
            <button
              type="button"
              className="button button-primary menu-go"
              disabled={busy}
              onClick={() =>
                onCreate({
                  kind: 'TEST',
                  rules: short ? 'PLAYTEST' : 'DEFAULT',
                  seats,
                  botStrengths: bots.slice(0, seats - 1),
                  mode: list.realmMatchesEnabled ? mode : 'CLASSIC',
                })
              }
            >
              {t('menu.practice.create')}
            </button>
          </div>
        </>
      )}
    </SheetFrame>
  );
}

/** Erlaubte Zeichen eines Codes; Groß- und Kleinschreibung egal, Leer- und Trennzeichen fallen weg. */
function cleanCode(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

/**
 * Mit Code beitreten: sechs Felder wie Spielsteine. Darüber liegt ein unsichtbares Eingabefeld, das
 * Tastatur, Einfügen und Autokorrektur des Systems bedient.
 */
export function JoinSheet({
  list,
  busy,
  error,
  onJoin,
  onBack,
}: {
  readonly list: MatchListResponse;
  readonly busy: boolean;
  readonly error: unknown;
  readonly onJoin: (code: string) => void;
  readonly onBack: () => void;
}) {
  const [code, setCode] = useState('');
  const inputId = useId();
  const hintId = useId();
  const open = openOf(list);
  const valid = /^[A-HJ-NP-Z2-9]{6}$/.test(code);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid && !busy) onJoin(code);
  }
  return (
    <SheetFrame
      title={t('menu.join.title')}
      sub={open ? undefined : t('menu.join.lead')}
      onBack={onBack}
      className="menu-join"
      testId="menu-join"
    >
      {open ? (
        <OpenNotice match={open} />
      ) : (
        <form className="menu-join-form" onSubmit={submit} noValidate>
          <label className="visually-hidden" htmlFor={inputId}>
            {t('menu.join.label')}
          </label>
          <span className="menu-code">
            {Array.from({ length: 6 }, (_, i) => (
              <span
                key={i}
                aria-hidden="true"
                className={`menu-code-tile${code[i] ? '' : ' empty'}${i === code.length ? ' next' : ''}`}
              >
                {code[i] ?? ''}
              </span>
            ))}
            <input
              id={inputId}
              className="menu-code-input"
              value={code}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="characters"
              spellCheck={false}
              enterKeyHint="go"
              aria-describedby={hintId}
              onChange={(event) => setCode(cleanCode(event.target.value))}
            />
          </span>
          <p className="menu-note menu-centre-text" id={hintId}>
            {t('menu.join.hint')}
          </p>
          {error ? <ErrorNote error={error} /> : null}
          <button type="submit" className="button button-primary menu-go" disabled={busy || !valid}>
            {t('menu.join.submit')}
          </button>
        </form>
      )}
    </SheetFrame>
  );
}

/** Chronik: Bilanz und die letzten beendeten Partien; ein Tipp zeigt ihr Ergebnis. */
export function ChronicleSheet({
  list,
  onBack,
}: {
  readonly list: MatchListResponse;
  readonly onBack: () => void;
}) {
  const { record } = list;
  const rate = hitRate(record);
  const done = list.matches.filter((m) => !isOpenMatch(m));
  const now = new Date();
  return (
    <SheetFrame
      title={t('menu.chronicle.title')}
      onBack={onBack}
      className="menu-chronicle"
      testId="menu-chronicle"
    >
      <dl className="menu-stats">
        <div>
          <dt>{tp('menu.chronicle.played', record.played)}</dt>
          <dd>{formatNumber(record.played)}</dd>
        </div>
        <div>
          <dt>{tp('menu.chronicle.won', record.won)}</dt>
          <dd>{formatNumber(record.won)}</dd>
        </div>
        <div>
          <dt>{t('menu.chronicle.rate')}</dt>
          <dd>{rate === null ? '–' : `${formatNumber(rate)}\u00a0%`}</dd>
        </div>
      </dl>
      {done.length === 0 ? (
        <p className="menu-note">{t('menu.chronicle.empty')}</p>
      ) : (
        <ul className="menu-rows">
          {done.map((match) => {
            const place = match.status === 'ABANDONED' ? 'off' : `p${match.place ?? 0}`;
            const detail = chronicleDetail(match);
            return (
              <li key={match.id}>
                <button
                  type="button"
                  className="menu-row"
                  data-testid="chronicle-row"
                  onClick={() => navigate({ name: 'match', matchId: match.id })}
                >
                  <span className={`menu-place ${place}`}>{placeText(match)}</span>
                  <span className="menu-row-text">
                    <span className="menu-row-top">
                      {modeText(match)} · {whenText(match.finishedAt ?? match.createdAt, now)}
                    </span>
                    {detail ? <span className="menu-row-sub">{detail}</span> : null}
                  </span>
                  <span className="menu-row-go" aria-hidden="true">
                    <MenuIcon kind="next" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </SheetFrame>
  );
}

/** Großer Knopf mit Zeichen, Titel und Unterzeile. */
function BigChoice({
  icon,
  title,
  sub,
  primary = false,
  disabled = false,
  onClick,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly sub: string;
  readonly primary?: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`menu-big${primary ? ' primary' : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="menu-big-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="menu-big-text">
        <span className="menu-big-title">{title}</span>
        <span className="menu-big-sub">{sub}</span>
      </span>
    </button>
  );
}

/**
 * Erster Besuch ohne Sitzung: als Gast sofort los, registrieren oder mit einem Konto anmelden.
 * Registrieren macht erst still einen Gast (so bleibt alles, was danach geschieht, am Konto) und
 * öffnet dann das Formular der Kontoseite (ADR-082).
 */
export function WelcomeSheet({ onLogin }: { readonly onLogin: () => void }) {
  const { startGuest, switching } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function guest(then?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await startGuest();
      then?.();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="sheet menu-sheet menu-welcome" aria-labelledby="menu-welcome-title">
      <h2 id="menu-welcome-title">{t('menu.welcome.title')}</h2>
      <p className="menu-lead">{t('menu.welcome.text')}</p>
      <div className="menu-welcome-choices">
        <BigChoice
          primary
          icon={<MenuIcon kind="play" />}
          title={t('menu.welcome.guest')}
          sub={t('menu.welcome.guestSub')}
          disabled={busy || switching}
          onClick={() => void guest()}
        />
        <BigChoice
          icon={<Icon kind="shield" size={22} />}
          title={t('menu.welcome.register')}
          sub={t('menu.welcome.registerSub')}
          disabled={busy || switching}
          onClick={() => void guest(() => navigate({ name: 'account', view: 'secure' }))}
        />
        <BigChoice
          icon={<MenuIcon kind="person" />}
          title={t('menu.welcome.account')}
          sub={t('menu.welcome.accountSub')}
          disabled={busy || switching}
          onClick={onLogin}
        />
      </div>
      {error ? <ErrorNote error={error} /> : null}
      <p className="menu-note">{t('menu.welcome.note')}</p>
    </section>
  );
}

/** Anmelden ohne Sitzung; danach zeigt das Menü die Siegel des Kontos. */
export function LoginSheet({ onBack }: { readonly onBack: () => void }) {
  return (
    <SheetFrame
      title={t('menu.welcome.loginTitle')}
      onBack={onBack}
      className="menu-login"
      testId="menu-login"
    >
      <LoginForm />
    </SheetFrame>
  );
}
