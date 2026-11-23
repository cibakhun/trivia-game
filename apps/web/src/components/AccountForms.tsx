import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  usernameSchema,
  type PlayerNamePartsDto,
} from '@rdw/protocol';
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ActionKey, ApiRequestError, api } from '../api/client.ts';
import { t } from '../i18n/i18n.ts';
import { useSession } from '../session.tsx';
import { ClientError, ErrorNote } from './ErrorNote.tsx';
import { NameChips } from './NameChips.tsx';
import type { NameChoice } from './NamePicker.tsx';

/**
 * Formulare der Kontoseite (O-03, ADR-043, Gestaltung ADR-080): Konto sichern, Anmelden,
 * Spielername und Passwort ändern. Eingaben werden vorab wie auf dem Server geprüft; der Server
 * bleibt maßgeblich. Anmelden steht auch im Hauptmenü ohne Sitzung und auf dem Einladungslink.
 */

export type PlayerChoice = NameChoice<PlayerNamePartsDto>;

async function loadPlayerNames(): Promise<readonly PlayerChoice[]> {
  return (await api.playerNames()).suggestions;
}

function passwordProblem(password: string): string | null {
  return password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH
    ? t('account.passwordInvalid', { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH })
    : null;
}

export function Field({
  label,
  hint,
  problem,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly problem?: string | null;
  readonly children: (ids: { id: string; describedBy: string | undefined }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const problemId = `${id}-problem`;
  const describedBy = [hint ? hintId : null, problem ? problemId : null].filter(Boolean).join(' ');
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, describedBy: describedBy || undefined })}
      {hint ? (
        <p id={hintId} className="muted field-hint">
          {hint}
        </p>
      ) : null}
      {problem ? (
        <p id={problemId} className="field-problem">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

function PasswordInput({
  value,
  onChange,
  autoComplete,
  ids,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly autoComplete: 'current-password' | 'new-password';
  readonly ids: { id: string; describedBy: string | undefined };
}) {
  return (
    <input
      id={ids.id}
      type="password"
      value={value}
      autoComplete={autoComplete}
      maxLength={PASSWORD_MAX_LENGTH}
      aria-describedby={ids.describedBy}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** Führt eine Formularaktion aus und hält Laufzustand und Fehler. */
function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(action: () => Promise<void>) {
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
  return { busy, error, setError, submit };
}

/**
 * Gast sichern (POST /auth/register) in zwei Schritten: erst der Spielername aus Vorschlägen, dann
 * Benutzername und Passwort. Den Schritt führt die Seite (`step`, `onStep`), damit ihr „Zurück“
 * erst zum Namen zurückgeht. `onPreview` meldet den gewählten Namen, damit die Wappenseite ihn
 * schon zeigt.
 */
export function RegisterForm({
  step,
  onStep,
  onDone,
  onPreview,
}: {
  readonly step: 1 | 2;
  readonly onStep: (step: 1 | 2) => void;
  readonly onDone: () => void;
  readonly onPreview?: (name: string | null) => void;
}) {
  const { reload } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [playerName, setPlayerName] = useState<PlayerChoice | null>(null);
  const [checked, setChecked] = useState(false);
  const { busy, error, setError, submit } = useSubmit();
  const key = useRef(new ActionKey());
  const userField = useRef<HTMLInputElement>(null);

  const problems = {
    username: usernameSchema.safeParse(username).success ? null : t('account.usernameInvalid'),
    password: passwordProblem(password),
    repeat: repeat === password ? null : t('account.passwordMismatch'),
  };
  // Ein vergebener Name gehört an das Feld; er verschwindet mit der nächsten Eingabe
  const taken = error instanceof ApiRequestError && error.code === 'USERNAME_TAKEN';

  function choose(choice: PlayerChoice) {
    setPlayerName(choice);
    onPreview?.(choice.name);
  }

  function go(next: 1 | 2) {
    onStep(next);
    if (next === 2) requestAnimationFrame(() => userField.current?.focus({ preventScroll: true }));
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (step === 1) {
      if (playerName) go(2);
      return;
    }
    setChecked(true);
    if (!playerName || Object.values(problems).some((problem) => problem !== null)) return;
    void submit(async () => {
      try {
        await api.register(
          { username, password, playerName: playerName.parts },
          key.current.current,
        );
      } catch (e) {
        key.current.settle(e);
        throw e;
      }
      // Fertig erst, wenn das Profil das gesicherte Konto zeigt. Bis dahin bleibt der Schlüssel:
      // Ein erneuter Klick liefert dieselbe Sicherung (Idempotenz) statt ALREADY_REGISTERED.
      const me = await reload({ discardStale: true });
      if (!me || me.user.isGuest) throw new ClientError('account.registerIncomplete');
      key.current.settle();
      onDone();
    });
  }

  const show = (problem: string | null) => (checked ? problem : null);

  return (
    <form
      className="form acct-form"
      onSubmit={onSubmit}
      noValidate
      data-testid="register-form"
      data-step={step}
    >
      <div className="acct-step" hidden={step !== 1}>
        <p className="menu-note">{t('konto.secure.nameLead')}</p>
        <NameChips
          legend={t('account.playerNameLegend')}
          load={loadPlayerNames}
          value={playerName}
          onChange={choose}
          testId="player-name-picker"
        />
      </div>
      <div className="acct-step" hidden={step !== 2}>
        <p className="menu-note">{t('konto.secure.accessLead')}</p>
        <Field
          label={t('account.username')}
          hint={t('konto.secure.usernameHint')}
          problem={taken ? t('errors.USERNAME_TAKEN') : show(problems.username)}
        >
          {(ids) => (
            <input
              id={ids.id}
              ref={userField}
              value={username}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={24}
              aria-describedby={ids.describedBy}
              onChange={(event) => {
                setUsername(event.target.value);
                if (taken) setError(null);
              }}
            />
          )}
        </Field>
        <div className="field-pair">
          <Field
            label={t('account.password')}
            hint={t('account.passwordHint', { min: PASSWORD_MIN_LENGTH })}
            problem={show(problems.password)}
          >
            {(ids) => (
              <PasswordInput
                ids={ids}
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
              />
            )}
          </Field>
          <Field label={t('account.passwordRepeat')} problem={show(problems.repeat)}>
            {(ids) => (
              <PasswordInput
                ids={ids}
                value={repeat}
                onChange={setRepeat}
                autoComplete="new-password"
              />
            )}
          </Field>
        </div>
      </div>
      {error && !taken ? <ErrorNote error={error} /> : null}
      <div className="acct-form-foot">
        <span className="acct-dots" aria-label={t('konto.secure.step', { n: step })}>
          <span className={step === 1 ? 'on' : undefined} />
          <span className={step === 2 ? 'on' : undefined} />
        </span>
        <button
          type="submit"
          className="button button-primary menu-go"
          disabled={busy || (step === 1 && !playerName)}
        >
          {step === 1 ? t('konto.secure.next') : t('account.register')}
        </button>
      </div>
    </form>
  );
}

/** Anmelden mit Benutzername und Passwort; ersetzt eine laufende Sitzung. */
export function LoginForm({
  warning,
  onDone,
}: {
  readonly warning?: string;
  readonly onDone?: () => void;
}) {
  const { login, switching } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [checked, setChecked] = useState(false);
  const { busy, error, submit } = useSubmit();
  const show = (value: string) => (checked && value === '' ? t('account.required') : null);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setChecked(true);
    if (username === '' || password === '') return;
    void submit(async () => {
      await login(username, password);
      onDone?.();
    });
  }

  return (
    <form className="form" onSubmit={onSubmit} noValidate data-testid="login-form">
      {warning ? <p className="note">{warning}</p> : null}
      <Field label={t('account.username')} problem={show(username)}>
        {(ids) => (
          <input
            id={ids.id}
            value={username}
            autoComplete="username"
            maxLength={64}
            required
            aria-describedby={ids.describedBy}
            onChange={(event) => setUsername(event.target.value)}
          />
        )}
      </Field>
      <Field label={t('account.password')} problem={show(password)}>
        {(ids) => (
          <PasswordInput
            ids={ids}
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />
        )}
      </Field>
      <button type="submit" className="button button-primary" disabled={busy || switching}>
        {t('account.login')}
      </button>
      {error ? <ErrorNote error={error} /> : null}
      <p className="muted">{t('account.forgotPassword')}</p>
    </form>
  );
}

/** Spielername ändern (PATCH /me/profile); `onPreview` zeigt die Wahl schon auf der Wappenseite. */
export function PlayerNameForm({
  current,
  onDone,
  onPreview,
}: {
  readonly current: PlayerChoice | null;
  readonly onDone: () => void;
  readonly onPreview?: (name: string | null) => void;
}) {
  const { reload } = useSession();
  const [playerName, setPlayerName] = useState<PlayerChoice | null>(current);
  const { busy, error, submit } = useSubmit();
  const key = useRef(new ActionKey());
  const unchanged = playerName?.name === current?.name;

  function choose(choice: PlayerChoice) {
    setPlayerName(choice);
    onPreview?.(choice.name === current?.name ? null : choice.name);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!playerName || unchanged) return;
    void submit(async () => {
      try {
        await api.updateProfile(playerName.parts, key.current.current);
        key.current.settle();
      } catch (e) {
        key.current.settle(e);
        throw e;
      }
      await reload();
      onDone();
    });
  }

  return (
    <form className="form acct-form" onSubmit={onSubmit} data-testid="player-name-form">
      <NameChips
        legend={t('account.playerNameLegend')}
        load={loadPlayerNames}
        value={playerName}
        current={current}
        onChange={choose}
      />
      {error ? <ErrorNote error={error} /> : null}
      <div className="acct-form-foot">
        <button
          type="submit"
          className="button button-primary menu-go"
          disabled={busy || unchanged}
        >
          {t('account.nameSave')}
        </button>
      </div>
    </form>
  );
}

/** Passwort ändern (POST /me/password); andere Geräte werden abgemeldet. */
export function PasswordForm({ onDone }: { readonly onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [checked, setChecked] = useState(false);
  const { busy, error, submit } = useSubmit();
  const key = useRef(new ActionKey());
  const problems = {
    password: passwordProblem(password),
    repeat: repeat === password ? null : t('account.passwordMismatch'),
  };

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setChecked(true);
    if (current === '' || problems.password || problems.repeat) return;
    void submit(async () => {
      try {
        await api.changePassword(
          { currentPassword: current, newPassword: password },
          key.current.current,
        );
        key.current.settle();
      } catch (e) {
        key.current.settle(e);
        // Derselbe Code wie bei der Anmeldung; hier ist nur das bisherige Passwort gemeint
        if (e instanceof ApiRequestError && e.code === 'INVALID_CREDENTIALS') {
          throw new ClientError('account.wrongCurrentPassword');
        }
        throw e;
      }
      setCurrent('');
      setPassword('');
      setRepeat('');
      setChecked(false);
      onDone();
    });
  }

  return (
    <form className="form acct-form" onSubmit={onSubmit} noValidate data-testid="password-form">
      <Field
        label={t('account.currentPassword')}
        problem={checked && current === '' ? t('account.required') : null}
      >
        {(ids) => (
          <PasswordInput
            ids={ids}
            value={current}
            onChange={setCurrent}
            autoComplete="current-password"
          />
        )}
      </Field>
      <div className="field-pair">
        <Field
          label={t('account.newPassword')}
          hint={t('account.passwordHint', { min: PASSWORD_MIN_LENGTH })}
          problem={checked ? problems.password : null}
        >
          {(ids) => (
            <PasswordInput
              ids={ids}
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
            />
          )}
        </Field>
        <Field label={t('account.newPasswordRepeat')} problem={checked ? problems.repeat : null}>
          {(ids) => (
            <PasswordInput
              ids={ids}
              value={repeat}
              onChange={setRepeat}
              autoComplete="new-password"
            />
          )}
        </Field>
      </div>
      {error ? <ErrorNote error={error} /> : null}
      <div className="acct-form-foot">
        <button type="submit" className="button button-primary menu-go" disabled={busy}>
          {t('account.passwordSave')}
        </button>
      </div>
    </form>
  );
}
