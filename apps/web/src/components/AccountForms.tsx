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
import { NamePicker, type NameChoice } from './NamePicker.tsx';

/**
 * Formulare der Kontoseite (O-03, ADR-043): Konto sichern, Anmelden, Spielername und Passwort
 * ändern. Eingaben werden vorab wie auf dem Server geprüft; der Server bleibt maßgeblich.
 */

type PlayerChoice = NameChoice<PlayerNamePartsDto>;

async function loadPlayerNames(): Promise<readonly PlayerChoice[]> {
  return (await api.playerNames()).suggestions;
}

function passwordProblem(password: string): string | null {
  return password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH
    ? t('account.passwordInvalid', { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH })
    : null;
}

function Field({
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

/** Gast sichern: Benutzername, Passwort und Spielername (POST /auth/register). */
export function RegisterForm({ onDone }: { readonly onDone: () => void }) {
  const { reload } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [playerName, setPlayerName] = useState<PlayerChoice | null>(null);
  const [checked, setChecked] = useState(false);
  const { busy, error, setError, submit } = useSubmit();
  const key = useRef(new ActionKey());

  const problems = {
    username: usernameSchema.safeParse(username).success ? null : t('account.usernameInvalid'),
    password: passwordProblem(password),
    repeat: repeat === password ? null : t('account.passwordMismatch'),
    playerName: playerName ? null : t('account.playerNameMissing'),
  };
  // Ein vergebener Name gehört an das Feld; er verschwindet mit der nächsten Eingabe
  const taken = error instanceof ApiRequestError && error.code === 'USERNAME_TAKEN';

  function onSubmit(event: FormEvent) {
    event.preventDefault();
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
    <form className="form" onSubmit={onSubmit} noValidate data-testid="register-form">
      <Field
        label={t('account.username')}
        hint={t('account.usernameHint')}
        problem={taken ? t('errors.USERNAME_TAKEN') : show(problems.username)}
      >
        {(ids) => (
          <input
            id={ids.id}
            value={username}
            autoComplete="username"
            maxLength={24}
            aria-describedby={ids.describedBy}
            onChange={(event) => {
              setUsername(event.target.value);
              if (taken) setError(null);
            }}
          />
        )}
      </Field>
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
      <NamePicker
        legend={t('account.playerNameLegend')}
        hint={t('account.playerNameHint')}
        load={loadPlayerNames}
        value={playerName}
        onChange={setPlayerName}
        testId="player-name-picker"
      />
      {show(problems.playerName) ? <p className="field-problem">{problems.playerName}</p> : null}
      <button type="submit" className="button button-primary" disabled={busy}>
        {t('account.register')}
      </button>
      {error && !taken ? <ErrorNote error={error} /> : null}
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

/** Spielername ändern (PATCH /me/profile). */
export function PlayerNameForm({
  current,
  onDone,
}: {
  readonly current: PlayerChoice | null;
  readonly onDone: () => void;
}) {
  const { reload } = useSession();
  const [playerName, setPlayerName] = useState<PlayerChoice | null>(current);
  const { busy, error, submit } = useSubmit();
  const key = useRef(new ActionKey());
  const unchanged = playerName?.name === current?.name;

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
    <form className="form" onSubmit={onSubmit} data-testid="player-name-form">
      <NamePicker
        legend={t('account.playerNameLegend')}
        hint={t('account.playerNameHint')}
        load={loadPlayerNames}
        value={playerName}
        onChange={setPlayerName}
      />
      <button type="submit" className="button button-primary" disabled={busy || unchanged}>
        {t('account.nameSave')}
      </button>
      {error ? <ErrorNote error={error} /> : null}
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
    <form className="form" onSubmit={onSubmit} noValidate data-testid="password-form">
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
      <button type="submit" className="button button-primary" disabled={busy}>
        {t('account.passwordSave')}
      </button>
      {error ? <ErrorNote error={error} /> : null}
    </form>
  );
}
