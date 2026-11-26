import {
  EMAIL_MAX_LENGTH,
  EMAIL_VERIFY_DAYS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  emailSchema,
  type EmailState,
} from '@rdw/protocol';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { ActionKey, ApiRequestError, api } from '../api/client.ts';
import { Icon } from '../art/Icons.tsx';
import { t, type MessageKey } from '../i18n/i18n.ts';
import { emailStatus } from '../menu/account-text.ts';
import { navigate } from '../router.ts';
import { useSession } from '../session.tsx';
import { ClientError, ErrorNote } from './ErrorNote.tsx';
import { NameField, nameUsable, useNameCheck, type NameCheckState } from './NameField.tsx';

/**
 * Formulare der Kontoseite (O-03, ADR-043, Gestaltung ADR-080, ADR-082, ADR-086): Registrieren,
 * Anmelden, Namen, Passwort und E-Mail-Adresse ändern, Konto löschen. Eingaben werden vorab wie auf
 * dem Server geprüft; der Server bleibt maßgeblich. Anmelden steht auch im Hauptmenü ohne Sitzung
 * und auf dem Einladungslink.
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

/** Prüft die Adresse wie der Server (`emailSchema`); `null` = passt. */
function emailProblem(email: string): string | null {
  if (email.trim() === '') return t('account.required');
  return emailSchema.safeParse(email).success ? null : t('account.emailInvalid');
}

function EmailInput({
  value,
  onChange,
  ids,
  inputRef,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly ids: { id: string; describedBy: string | undefined };
  readonly inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <input
      id={ids.id}
      ref={inputRef}
      type="email"
      inputMode="email"
      autoComplete="email"
      autoCapitalize="none"
      spellCheck={false}
      value={value}
      maxLength={EMAIL_MAX_LENGTH}
      aria-describedby={ids.describedBy}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** Eine Adresse, die ein anderes Konto schon bestätigt hat, gehört an das Feld. */
function emailTaken(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === 'EMAIL_TAKEN';
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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [checked, setChecked] = useState(false);
  const [nameLeft, setNameLeft] = useState(false);
  // Adresse, die ein anderes Konto schon bestätigt hat (EMAIL_TAKEN)
  const [takenEmail, setTakenEmail] = useState<string | null>(null);
  const { busy, error, submit } = useSubmit();
  const key = useRef(new ActionKey());
  const check = useNameCheck(username);
  const userField = useRef<HTMLInputElement>(null);
  const emailField = useRef<HTMLInputElement>(null);

  const problems = {
    email:
      emailProblem(email) ??
      (takenEmail !== null && takenEmail === email.trim() ? t('errors.EMAIL_TAKEN') : null),
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
    if (problems.email !== null) {
      emailField.current?.focus();
      return;
    }
    if (Object.values(problems).some((problem) => problem !== null)) return;
    const name = check.name;
    const address = email.trim();
    void submit(async () => {
      try {
        await api.register(
          { username: name, email: address, password },
          key.current.for({ name, address }),
        );
      } catch (e) {
        key.current.settle(e);
        if (nameRejected(e, check)) {
          userField.current?.focus();
          return;
        }
        if (emailTaken(e)) {
          setTakenEmail(address);
          emailField.current?.focus();
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
      {/* Breit genug: Adresse und beide Passwörter in einer Zeile (account.css) */}
      <div className="register-secrets">
        <Field
          label={t('account.email')}
          hint={t('account.emailHint', { days: EMAIL_VERIFY_DAYS })}
          problem={show(problems.email)}
        >
          {(ids) => (
            <EmailInput ids={ids} value={email} onChange={setEmail} inputRef={emailField} />
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
  start = current,
  onDone,
  onPreview,
}: {
  readonly current: string;
  /** Anfangswert des Feldes; bei gesperrtem Namen leer (ADR-086). */
  readonly start?: string;
  readonly onDone: () => void;
  readonly onPreview?: (name: string | null) => void;
}) {
  const { reload } = useSession();
  const [username, setUsername] = useState(start);
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

/**
 * E-Mail-Adresse (ADR-086): oben der Stand (bestätigt, wartet, Frist), darunter „Link neu senden“
 * und die neue Adresse. Eine bestätigte Adresse gilt weiter, bis die neue bestätigt ist.
 * `onSaved` meldet eine gespeicherte Adresse mit dem Text für die Meldung.
 */
export function EmailForm({
  email,
  onSaved,
}: {
  readonly email: EmailState;
  readonly onSaved: (notice: MessageKey, params: { email: string }) => void;
}) {
  const { reload } = useSession();
  const [address, setAddress] = useState('');
  const [checked, setChecked] = useState(false);
  const [takenEmail, setTakenEmail] = useState<string | null>(null);
  const save = useSubmit();
  const resend = useSubmit();
  const [resent, setResent] = useState<string | null>(null);
  const saveKey = useRef(new ActionKey());
  const resendKey = useRef(new ActionKey());
  const field = useRef<HTMLInputElement>(null);
  const status = emailStatus(email);
  const linkTarget = email.pending ?? (email.verified ? null : email.address);
  const typed = address.trim();
  const same =
    typed !== '' &&
    email.address !== null &&
    email.pending === null &&
    typed.toLowerCase() === email.address.toLowerCase() &&
    email.verified;
  const problem =
    emailProblem(address) ??
    (same ? t('konto.email.same') : null) ??
    (takenEmail !== null && takenEmail === typed ? t('errors.EMAIL_TAKEN') : null);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setChecked(true);
    if (problem !== null) {
      field.current?.focus();
      return;
    }
    void save.submit(async () => {
      let result;
      try {
        result = await api.changeEmail(typed, saveKey.current.for(typed));
        saveKey.current.settle();
      } catch (e) {
        saveKey.current.settle(e);
        if (emailTaken(e)) {
          setTakenEmail(typed);
          field.current?.focus();
          return;
        }
        throw linkError(e);
      }
      await reload();
      setAddress('');
      setChecked(false);
      if (!result.mailSent && result.email.pending === null && result.email.verified) {
        // Zurück zur bestätigten Adresse: Der wartende Wechsel entfällt
        onSaved('konto.email.cancelled', { email: result.email.address ?? typed });
      } else if (!result.mailSent) {
        throw new ClientError('konto.email.notSent');
      } else {
        onSaved('konto.email.sent', { email: typed });
      }
    });
  }

  function onResend() {
    setResent(null);
    void resend.submit(async () => {
      let result;
      try {
        result = await api.resendEmailLink(resendKey.current.current);
        resendKey.current.settle();
      } catch (e) {
        resendKey.current.settle(e);
        throw linkError(e);
      }
      if (!result.mailSent) throw new ClientError('konto.email.notSent');
      setResent(linkTarget);
    });
  }

  return (
    <div className="acct-email" data-testid="email-form">
      <div className={`acct-callout acct-email-status ${status.tone}`} data-testid="email-status">
        <span className="acct-callout-icon" aria-hidden="true">
          <Icon kind={status.tone === 'done' ? 'shield' : 'mail'} size={22} />
        </span>
        <span className="acct-callout-text">
          <b>{status.title}</b>
          <span>{status.text}</span>
        </span>
        {linkTarget !== null ? (
          <button
            type="button"
            className="button button-small acct-resend"
            disabled={resend.busy}
            onClick={onResend}
            data-testid="email-resend"
          >
            {t('konto.email.resend')}
          </button>
        ) : null}
      </div>
      {resent !== null ? (
        <p className="acct-sent" role="status">
          {t('konto.email.sent', { email: resent })}
        </p>
      ) : null}
      {resend.error ? <ErrorNote error={resend.error} /> : null}
      <form className="form acct-form" onSubmit={onSubmit} noValidate>
        <Field
          label={email.address === null ? t('konto.email.address') : t('konto.email.newAddress')}
          problem={checked ? problem : null}
        >
          {(ids) => <EmailInput ids={ids} value={address} onChange={setAddress} inputRef={field} />}
        </Field>
        {save.error ? <ErrorNote error={save.error} /> : null}
        <div className="acct-form-foot">
          <button type="submit" className="button button-primary menu-go" disabled={save.busy}>
            {t('konto.email.save')}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Bremse für Links (429): eine Minute Abstand oder genug für heute. */
function linkError(error: unknown): unknown {
  if (error instanceof ApiRequestError && error.code === 'RATE_LIMITED') {
    const retry = error.details.retryAfterMs;
    return new ClientError(
      typeof retry === 'number' && retry > 2 * 60_000
        ? 'konto.email.waitDay'
        : 'konto.email.waitMinute',
    );
  }
  return error;
}

/**
 * Konto löschen (O-47, ADR-086). Gesicherte Konten bestätigen mit dem Passwort und haben sieben
 * Tage Bedenkzeit: Eine Anmeldung bis dahin hebt den Antrag auf. Gäste werden sofort gelöscht.
 * Danach gibt es keine Sitzung mehr; das Hauptmenü sagt, was geschieht.
 */
export function DeleteForm({
  isGuest,
  onKeep,
}: {
  readonly isGuest: boolean;
  readonly onKeep: () => void;
}) {
  const { deleteAccount, switching } = useSession();
  const [password, setPassword] = useState('');
  const [checked, setChecked] = useState(false);
  const { busy, error, submit } = useSubmit();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setChecked(true);
    if (!isGuest && password === '') return;
    void submit(async () => {
      try {
        await deleteAccount(isGuest ? null : password);
      } catch (e) {
        // Derselbe Code wie bei der Anmeldung; hier ist nur das Passwort gemeint
        if (e instanceof ApiRequestError && e.code === 'INVALID_CREDENTIALS') {
          throw new ClientError('konto.delete.wrongPassword');
        }
        throw e;
      }
      navigate({ name: 'start' }, { replace: true });
    });
  }

  return (
    <form
      className="form acct-form acct-delete"
      onSubmit={onSubmit}
      noValidate
      data-testid="delete-form"
    >
      <div className="acct-callout warn">
        <b>{t('konto.delete.title')}</b>
        <span>{isGuest ? t('konto.delete.guestText') : t('konto.delete.text')}</span>
      </div>
      {isGuest ? null : (
        <Field
          label={t('konto.delete.password')}
          problem={checked && password === '' ? t('account.required') : null}
        >
          {(ids) => (
            <PasswordInput
              ids={ids}
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
            />
          )}
        </Field>
      )}
      {error ? <ErrorNote error={error} /> : null}
      <div className="acct-form-foot">
        <button
          type="submit"
          className="button button-danger acct-anyway"
          disabled={busy || switching}
          data-testid="delete-confirm"
        >
          {t('konto.delete.confirm')}
        </button>
        <button type="button" className="button button-primary menu-go" onClick={onKeep}>
          {t('konto.delete.keep')}
        </button>
      </div>
    </form>
  );
}
