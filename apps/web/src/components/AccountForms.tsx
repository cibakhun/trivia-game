import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@rdw/protocol';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ActionKey, ApiRequestError, api } from '../api/client.ts';
import { t } from '../i18n/i18n.ts';
import { useSession } from '../session.tsx';
import { ClientError, ErrorNote } from './ErrorNote.tsx';
import { NameField, nameUsable, useNameCheck, type NameCheckState } from './NameField.tsx';

/**
 * Formulare der Kontoseite (O-03, ADR-043, Gestaltung ADR-080, ADR-082): Registrieren, Anmelden,
 * Namen und Passwort ändern. Eingaben werden vorab wie auf dem Server geprüft; der Server bleibt
 * maßgeblich. Anmelden steht auch im Hauptmenü ohne Sitzung und auf dem Einladungslink.
 */

/**
 * Ein abgelehnter Name gehört an das Namensfeld statt in eine Fehlermeldung unter dem Formular:
 * Die Prüfung merkt ihn sich, die Zeile unter dem Feld sagt dann „vergeben“ bzw. „nicht erlaubt“.
 */
function nameRejected(error: unknown, check: NameCheckState): boolean {
  if (!(error instanceof ApiRequestError)) return false;
  if (error.code === 'USERNAME_TAKEN') check.remember(check.name, 'TAKEN');
  else if (error.code === 'NAME_NOT_ALLOWED') check.remember(check.name, 'BLOCKED');
  else return false;
  return true;
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
 * Registrieren (POST /auth/register, ADR-082): eigener Benutzername mit Prüfung beim Tippen und
 * Ideen zum Antippen, dazu Passwort und Wiederholung. Aus dem Gast wird ein Konto, sein Spielstand
 * bleibt. `onPreview` meldet den getippten Namen, solange er passt, damit die Wappenseite ihn
 * schon zeigt.
 */
export function RegisterForm({
  onDone,
  onPreview,
}: {
  readonly onDone: () => void;
  readonly onPreview?: (name: string | null) => void;
}) {
  const { reload } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [checked, setChecked] = useState(false);
  const [nameLeft, setNameLeft] = useState(false);
  const { busy, error, submit } = useSubmit();
  const key = useRef(new ActionKey());
  const check = useNameCheck(username);
  const userField = useRef<HTMLInputElement>(null);

  const problems = {
    password: passwordProblem(password),
    repeat: repeat === password ? null : t('account.passwordMismatch'),
  };

  // Die Wappenseite zeigt den Namen mit, sobald er den Regeln folgt und nicht vergeben ist
  const preview = nameUsable(check) ? check.name : null;
  useEffect(() => {
    onPreview?.(preview);
  }, [preview, onPreview]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setChecked(true);
    if (!nameUsable(check)) {
      userField.current?.focus();
      return;
    }
    if (Object.values(problems).some((problem) => problem !== null)) return;
    const name = check.name;
    void submit(async () => {
      try {
        await api.register({ username: name, password }, key.current.current);
      } catch (e) {
        key.current.settle(e);
        if (nameRejected(e, check)) {
          userField.current?.focus();
          return;
        }
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
    <form className="form acct-form" onSubmit={onSubmit} noValidate data-testid="register-form">
      <p className="menu-note acct-lead register-lead">{t('konto.secure.lead')}</p>
      <div onBlur={() => setNameLeft(check.name !== '')}>
        <NameField
          label={t('account.username')}
          value={username}
          onChange={setUsername}
          check={check}
          showAll={checked || nameLeft}
          inputRef={userField}
          testId="register-name"
        />
      </div>
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
      {error ? <ErrorNote error={error} /> : null}
      <div className="acct-form-foot">
        <button type="submit" className="button button-primary menu-go" disabled={busy}>
          {t('account.register')}
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

/**
 * Namen ändern (PATCH /me/profile, ADR-082): derselbe Name gilt danach auch zum Anmelden.
 * `onPreview` zeigt einen passenden neuen Namen schon auf der Wappenseite.
 */
export function NameForm({
  current,
  onDone,
  onPreview,
}: {
  readonly current: string;
  readonly onDone: () => void;
  readonly onPreview?: (name: string | null) => void;
}) {
  const { reload } = useSession();
  const [username, setUsername] = useState(current);
  const [checked, setChecked] = useState(false);
  const { busy, error, submit } = useSubmit();
  const key = useRef(new ActionKey());
  const check = useNameCheck(username);
  const field = useRef<HTMLInputElement>(null);
  const unchanged = check.name === current;

  const preview = nameUsable(check) && !unchanged ? check.name : null;
  useEffect(() => {
    onPreview?.(preview);
  }, [preview, onPreview]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setChecked(true);
    if (unchanged) return;
    if (!nameUsable(check)) {
      field.current?.focus();
      return;
    }
    const name = check.name;
    void submit(async () => {
      try {
        await api.updateProfile(name, key.current.current);
        key.current.settle();
      } catch (e) {
        key.current.settle(e);
        if (nameRejected(e, check)) {
          field.current?.focus();
          return;
        }
        throw e;
      }
      await reload();
      onDone();
    });
  }

  return (
    <form className="form acct-form" onSubmit={onSubmit} noValidate data-testid="name-form">
      <NameField
        label={t('account.newName')}
        value={username}
        onChange={setUsername}
        check={check}
        showAll={checked}
        inputRef={field}
        testId="rename-name"
      />
      <p className="menu-note acct-lead">{t('konto.names.loginToo')}</p>
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
