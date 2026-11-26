import { expect, test, type Page } from '@playwright/test';
import { decideName } from '@rdw/server';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { closeAnswerDb, testDb } from './answers.ts';
import { E2E_MAIL_DIR } from './env.ts';
import { newPlayer } from './match-kit.ts';

/**
 * Registrieren (O-03, ADR-082) auf der Kontoseite (ADR-080): Ein Gast tritt bei, öffnet sein
 * Konto und registriert sich mit einem selbst getippten Benutzernamen (Prüfung beim Tippen, Ideen
 * zum Antippen) und Passwort, meldet sich auf einem zweiten Gerät an und findet dort sein Reich
 * wieder. Die Ansichten der Kontoseite haben eigene Pfade; „Zurück“ im Browser schließt sie.
 * Abmelden beendet nur die Sitzung des einen Geräts. Die Weltwahl zeigt die eigene Welt zum
 * Weiterspielen; ins Hauptmenü kommt man ohne Sitzung über „Ich habe ein Konto“.
 *
 * Seit ADR-086 gehört eine E-Mail-Adresse zum Registrieren. Die Mails landen als Dateien im
 * Ausgang des Testservers (`E2E_MAIL_DIR`); der Server tut dort so, als gingen sie hinaus, damit
 * die Frist von 30 Tagen gilt und angezeigt wird.
 */

const PASSWORD = 'e2e-pw7';

test.afterAll(async () => {
  await closeAnswerDb();
});

/** Registrieren vom Willkommensblatt aus, bis die Kontoseite „Registriert“ zeigt. */
async function registerFromWelcome(page: Page, name: string, email: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /^Registrieren/ }).click();
  await expect(page).toHaveURL(/\/konto\/registrieren$/);
  const form = page.getByTestId('register-form');
  await form.getByTestId('register-name').getByLabel('Benutzername').fill(name);
  await form.getByLabel('E-Mail-Adresse').fill(email);
  await form.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await form.getByLabel('Passwort wiederholen').fill(PASSWORD);
  await form.getByRole('button', { name: 'Registrieren' }).click();
  await expect(page.getByTestId('account-status')).toHaveText('Registriert');
}

/** Pfad des Bestätigungslinks aus der letzten Mail an diese Adresse. */
async function mailLink(address: string): Promise<string> {
  let text = '';
  await expect
    .poll(async () => {
      const files = (await readdir(E2E_MAIL_DIR).catch(() => []))
        .filter((file) => file.includes(address))
        .sort();
      const last = files.at(-1);
      text = last ? await readFile(join(E2E_MAIL_DIR, last), 'utf8') : '';
      return text;
    })
    .toContain('/email/bestaetigen/');
  const link = /\/email\/bestaetigen\/[A-Za-z0-9_-]{43}/.exec(text);
  if (!link) throw new Error(`Kein Bestätigungslink in der Mail an ${address}`);
  return link[0];
}

test('Konto: Gast registriert sich und spielt auf einem zweiten Gerät weiter', async ({
  browser,
}) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Als Gast spielen' }).click();
  // Die Welten stehen nicht im Hauptmenü (ADR-074), sie bleiben unter ihrem Pfad erreichbar
  await expect(page.getByRole('button', { name: 'Neue Partie' })).toBeVisible();
  await page.goto('/welten');
  const world = page.getByTestId('world-e2e');
  await world.getByRole('button', { name: 'Beitreten' }).click();
  await world.getByRole('button', { name: 'Reich gründen' }).click();
  await expect(page).toHaveURL(/\/play\//);
  const playUrl = page.url();
  const kingdomName = (await page.getByRole('banner').locator('strong').innerText()).trim();

  // Kontoseite als Blatt im Menü: Wappenseite, Bilanz ohne beendete Partie
  await page.getByTestId('nav-account').click();
  await expect(page).toHaveURL(/\/konto$/);
  const account = page.getByTestId('account');
  await expect(account.getByTestId('account-status')).toHaveText('Gast · nicht registriert');
  await expect(account.getByTestId('account-tier')).toContainText('Holzwappen');
  await expect(account.getByText('Noch keine Partie beendet')).toBeVisible();
  await account.getByRole('tab', { name: 'Wissen' }).click();
  await expect(account.getByTestId('knowledge-rows').locator('li')).toHaveCount(11);

  // „Registrieren“ hat einen eigenen Pfad; „Zurück“ im Browser schließt die Ansicht wieder
  await account.getByRole('tab', { name: 'Zugang' }).click();
  // Der Fokus geht auf den Titel des Formulars und beim Schließen auf den Reiter zurück
  await account.getByRole('button', { name: /^Registrieren/ }).click();
  await expect(page).toHaveURL(/\/konto\/registrieren$/);
  await expect(account.getByRole('heading', { name: 'Registrieren' })).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL(/\/konto$/);
  await expect(account).toHaveAttribute('data-view', 'home');
  const accessTab = account.getByRole('tab', { name: 'Zugang' });
  await expect(accessTab).toHaveAttribute('aria-selected', 'true');
  await expect(accessTab).toBeFocused();
  await account.getByRole('button', { name: /^Registrieren/ }).click();
  await expect(account).toHaveAttribute('data-view', 'secure');

  // Eigener Name: Regeln und Wortfilter melden sich beim Tippen, eine Idee füllt das Feld
  const form = account.getByTestId('register-form');
  const nameField = form.getByTestId('register-name');
  const nameInput = nameField.getByLabel('Benutzername');
  const line = nameField.getByTestId('name-line');
  await nameInput.fill('Krisz!');
  await expect(line).toHaveText('Erlaubt sind Buchstaben, Ziffern, Leerzeichen und _ . -');
  await nameInput.fill('Fuuuck');
  await expect(line).toHaveText('Dieser Name ist nicht erlaubt.');
  const idea = nameField.locator('.name-idea').first();
  const ideaName = (await idea.innerText()).trim();
  await idea.click();
  await expect(nameInput).toHaveValue(ideaName);
  await expect(line).toHaveText('Der Name ist frei.');
  await expect(account.getByTestId('account-name')).toHaveText(ideaName);

  // Der eigene Name mit Leerzeichen und Akzent; außen Leerraum, innen doppelt: wird vereinheitlicht
  const playerName = `Ödön ${Date.now().toString(36)}`;
  await nameInput.fill(`  ${playerName.replace(' ', '   ')} `);
  await expect(line).toHaveText('Der Name ist frei.');
  await expect(account.getByTestId('account-name')).toHaveText(playerName);
  // Ohne gültige E-Mail-Adresse geht es nicht (ADR-086)
  const emailInput = form.getByLabel('E-Mail-Adresse');
  await emailInput.fill('oedoen@');
  await form.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await form.getByLabel('Passwort wiederholen').fill(PASSWORD);
  await form.getByRole('button', { name: 'Registrieren' }).click();
  await expect(form).toContainText('Bitte gib eine gültige E-Mail-Adresse ein.');
  await expect(emailInput).toBeFocused();
  await emailInput.fill(`oedoen.${Date.now().toString(36)}@example.org`);
  // Ein Tippfehler bei der Wiederholung hält auf
  await form.getByLabel('Passwort wiederholen').fill(`${PASSWORD}x`);
  await form.getByRole('button', { name: 'Registrieren' }).click();
  await expect(form).toContainText('Die Passwörter stimmen nicht überein.');
  await form.getByLabel('Passwort wiederholen').fill(PASSWORD);
  await form.getByRole('button', { name: 'Registrieren' }).click();

  await expect(account.getByTestId('account-notice')).toHaveText(
    `Willkommen, ${playerName}! Du bist registriert.`,
  );
  await expect(page).toHaveURL(/\/konto$/);
  await expect(account.getByTestId('account-status')).toHaveText('Registriert');
  await expect(account.getByTestId('account-name')).toHaveText(playerName);
  await expect(account.locator('.acct-rows')).toContainText(playerName);
  await expect(page.getByTestId('menu-plate')).toContainText(playerName);

  // Zweites Gerät: falsches Passwort, dann richtig (Schreibweise des Namens egal)
  const other = await (await browser.newContext()).newPage();
  await other.goto('/');
  await other.getByRole('button', { name: 'Ich habe ein Konto' }).click();
  const login = other.getByTestId('login-form');
  // Anmelden mit demselben Namen, Schreibweise egal
  await login.getByLabel('Benutzername').fill(playerName.toUpperCase());
  await login.getByLabel('Passwort').fill('falsches-passwort');
  await login.getByRole('button', { name: 'Anmelden' }).click();
  await expect(login.getByRole('alert')).toHaveText('Benutzername oder Passwort ist falsch.');
  await login.getByLabel('Passwort').fill(PASSWORD);
  await login.getByRole('button', { name: 'Anmelden' }).click();
  // Angemeldet zeigt das Hauptmenü die Plakette mit dem Spielernamen; die Weltwahl bietet die
  // eigene Welt zum Weiterspielen (ADR-050)
  await expect(other.getByTestId('menu-plate')).toContainText(playerName);
  await expect(other.getByRole('button', { name: 'Neue Partie' })).toBeVisible();
  await other.goto('/welten');
  await other.getByTestId('world-e2e').getByRole('button', { name: 'Weiterspielen' }).click();
  await expect(other).toHaveURL(playUrl);
  await expect(other.getByRole('banner')).toContainText(kingdomName);
  await expect(other.getByTestId('nav-account')).toHaveText('Konto');

  // Weltwahl: die eigene Welt zum Weiterspielen, die andere zum Beitreten
  await other.getByRole('button', { name: 'Welten' }).click();
  await expect(other).toHaveURL(/\/welten$/);
  await expect(other.getByTestId('world-spieltest').getByRole('button')).toHaveText('Beitreten');
  await other.getByTestId('world-e2e').getByRole('button', { name: 'Weiterspielen' }).click();
  await expect(other).toHaveURL(playUrl);

  // Abmelden auf dem ersten Gerät; das zweite bleibt angemeldet
  await account.getByTestId('account-logout').click();
  await expect(page.getByRole('button', { name: 'Als Gast spielen' })).toBeVisible();
  await other.reload();
  await expect(other.getByRole('banner')).toContainText(kingdomName);
});

test('Konto: Ein Gast wird vor dem Abmelden gewarnt und kann sich erst registrieren', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Als Gast spielen' }).click();
  await page.getByTestId('menu-plate').click();
  const account = page.getByTestId('account');
  await expect(page).toHaveURL(/\/konto$/);
  await account.getByRole('tab', { name: 'Zugang' }).click();
  await account.getByRole('button', { name: 'Abmelden' }).click();
  await expect(page).toHaveURL(/\/konto\/abmelden$/);
  await expect(account).toContainText('Ohne Registrierung ist dein Gastkonto danach weg');
  // „Erst registrieren“ ersetzt die Ansicht: „Zurück“ führt danach nicht zur Warnung
  await account.getByRole('button', { name: 'Erst registrieren' }).click();
  await expect(page).toHaveURL(/\/konto\/registrieren$/);
  await expect(account.getByTestId('register-form')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/konto$/);
  // Gesicherte Ansichten gibt es für Gäste nicht: Der Pfad führt zur Kontoseite zurück
  await page.goto('/konto/passwort');
  await expect(page).toHaveURL(/\/konto$/);
  await expect(page.getByTestId('account')).toHaveAttribute('data-view', 'home');
  // Bewusst abmelden: zurück zum Start
  await page.goto('/konto/abmelden');
  await page.getByRole('button', { name: 'Trotzdem abmelden' }).click();
  await expect(page.getByRole('button', { name: 'Als Gast spielen' })).toBeVisible();
});

test('Konto: Registrieren direkt vom Willkommensblatt, vergebener Name wird gemeldet', async ({
  browser,
}) => {
  // Ein erstes Konto belegt einen Namen
  const first = await (await browser.newContext()).newPage();
  await first.goto('/');
  await first.getByRole('button', { name: /^Registrieren/ }).click();
  await expect(first).toHaveURL(/\/konto\/registrieren$/);
  const taken = `Fuchs ${Date.now().toString(36)}`;
  const firstForm = first.getByTestId('register-form');
  await firstForm.getByTestId('register-name').getByLabel('Benutzername').fill(taken);
  await firstForm.getByLabel('E-Mail-Adresse').fill(`fuchs.${Date.now().toString(36)}@example.org`);
  await firstForm.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await firstForm.getByLabel('Passwort wiederholen').fill(PASSWORD);
  await firstForm.getByRole('button', { name: 'Registrieren' }).click();
  await expect(first.getByTestId('account-status')).toHaveText('Registriert');

  // Ein zweiter Besucher will denselben Namen in anderer Schreibweise
  const page = await (await browser.newContext()).newPage();
  await page.goto('/');
  await page.getByRole('button', { name: /^Registrieren/ }).click();
  const form = page.getByTestId('register-form');
  const nameField = form.getByTestId('register-name');
  await nameField.getByLabel('Benutzername').fill(taken.toLowerCase().replace(' ', '_'));
  await expect(nameField.getByTestId('name-line')).toHaveText('Den Namen trägt schon jemand.');
  // Absenden geht so nicht: Der Fokus springt zurück ins Namensfeld
  await form.getByLabel('E-Mail-Adresse').fill(`fuchs2.${Date.now().toString(36)}@example.org`);
  await form.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await form.getByLabel('Passwort wiederholen').fill(PASSWORD);
  await form.getByRole('button', { name: 'Registrieren' }).click();
  await expect(nameField.getByLabel('Benutzername')).toBeFocused();
  await expect(page.getByTestId('account-status')).toHaveText('Gast · nicht registriert');
});

test('Konto: E-Mail bestätigen, Konto löschen und mit der Anmeldung zurückholen', async ({
  browser,
}) => {
  const stamp = Date.now().toString(36);
  const name = `Elster ${stamp}`;
  const address = `elster.${stamp}@example.org`;
  const page = await (await browser.newContext()).newPage();
  await registerFromWelcome(page, name, address);

  // Unbestätigt mahnt die Plakette im Hauptmenü mit der Frist und führt zur Ansicht „E-Mail“
  await page.goto('/');
  const plate = page.getByTestId('menu-plate');
  await expect(plate).toContainText(/E-Mail bestätigen bis \d{1,2}\. \p{L}+/u);
  await plate.click();
  await expect(page).toHaveURL(/\/konto\/email$/);
  await expect(page.getByTestId('email-status')).toContainText(/Bitte bis .+ bestätigen/);
  // Ein neuer Link geht erst nach einer Minute wieder hinaus
  await page.getByRole('button', { name: 'Link neu senden' }).click();
  await expect(page.getByTestId('email-form').getByRole('alert')).toContainText('Minute');

  // Der Link aus der Mail wirkt auch ohne Sitzung, etwa in der Mail-App auf dem Handy
  const link = await mailLink(address);
  const phone = await (await browser.newContext()).newPage();
  await phone.goto(link);
  await expect(phone.getByText('Adresse bestätigt')).toBeVisible();
  await expect(phone.getByText(address)).toBeVisible();
  await expect(phone.getByRole('button', { name: 'Zur Kontoseite' })).toBeHidden();
  // Noch einmal geöffnet (Mail-Apps öffnen Links oft vorab) bleibt es bei „bestätigt“
  await phone.reload();
  await expect(phone.getByText('Adresse bestätigt')).toBeVisible();

  // Bestätigt: keine Mahnung mehr, im Reiter Zugang steht „bestätigt“
  await page.goto('/');
  await expect(plate).toContainText(name);
  await expect(plate).not.toContainText('E-Mail bestätigen');
  await plate.click();
  const account = page.getByTestId('account');
  await account.getByRole('tab', { name: 'Zugang' }).click();
  await expect(account.getByTestId('account-email')).toContainText(address);
  await expect(account.getByTestId('account-email')).toContainText('bestätigt');

  // Konto löschen verlangt das Passwort und lässt sieben Tage Bedenkzeit
  await account.getByTestId('account-delete').click();
  await expect(page).toHaveURL(/\/konto\/loeschen$/);
  const remove = page.getByTestId('delete-form');
  await remove.getByLabel('Passwort zur Bestätigung').fill('falsches-passwort');
  await remove.getByTestId('delete-confirm').click();
  await expect(remove).toContainText('Das Passwort ist falsch.');
  await remove.getByLabel('Passwort zur Bestätigung').fill(PASSWORD);
  await remove.getByTestId('delete-confirm').click();
  const flash = page.getByTestId('session-flash');
  await expect(flash).toContainText(/Dein Konto wird am .+ gelöscht/);
  await expect(page.getByRole('button', { name: 'Als Gast spielen' })).toBeVisible();
  await flash.getByRole('button', { name: 'Schließen' }).click();
  await expect(flash).toBeHidden();

  // Wer sich in der Frist anmeldet, behält sein Konto
  await page.getByRole('button', { name: 'Ich habe ein Konto' }).click();
  const login = page.getByTestId('login-form');
  await login.getByLabel('Benutzername').fill(name);
  await login.getByLabel('Passwort').fill(PASSWORD);
  await login.getByRole('button', { name: 'Anmelden' }).click();
  await expect(flash).toContainText('Willkommen zurück! Dein Konto bleibt');
  await expect(plate).toContainText(name);
});

test('Konto: Ein gemeldeter Name wird gesperrt, der Spieler gibt sich einen neuen', async ({
  browser,
}) => {
  const host = await newPlayer(browser);
  await host
    .getByRole('region', { name: 'Neue Partie' })
    .getByRole('button', { name: 'Partie eröffnen' })
    .click();
  await expect(host).toHaveURL(/\/partie\/[0-9a-f-]{36}$/);
  const code = (await host.getByTestId('invite-code').innerText()).trim();
  // Allein in der Aufstellung gibt es nichts zu melden
  await expect(host.getByTestId('report-open')).toBeHidden();

  // Ein registrierter Spieler mit eigenem Namen tritt bei
  const stamp = Date.now().toString(36);
  const name = `Kauz ${stamp}`;
  const friend = await (await browser.newContext()).newPage();
  await registerFromWelcome(friend, name, `kauz.${stamp}@example.org`);
  await friend.goto(`/partie/beitreten/${code}`);
  await expect(friend).toHaveURL(host.url());

  // Melden: Der einzige Name ist schon gewählt
  await host.getByTestId('report-open').click();
  const sheet = host.getByTestId('report-sheet');
  await expect(sheet.getByTestId('report-confirm')).toHaveText(`„${name}“ melden`);
  await sheet.getByTestId('report-confirm').click();
  await expect(sheet).toContainText(`Danke! Die Spielleitung sieht sich „${name}“ an.`);
  await host.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  // Die Spielleitung sperrt ihn (sonst mit `pnpm account:name-reports --block=…`)
  expect(await decideName(testDb(), name, 'BLOCK')).toMatchObject({
    mustRename: true,
    resolved: 1,
  });

  // Der Spieler sieht es an der Plakette und gibt sich einen neuen Namen
  await friend.goto('/');
  const plate = friend.getByTestId('menu-plate');
  await expect(plate).toContainText('Neuen Namen wählen');
  await plate.click();
  await expect(friend).toHaveURL(/\/konto\/name$/);
  await expect(friend.getByTestId('name-blocked')).toContainText('Dein Name wurde gesperrt');
  const field = friend.getByTestId('rename-name');
  const input = field.getByLabel('Neuer Benutzername');
  await expect(input).toHaveValue('');
  await input.fill(name.toUpperCase());
  await expect(field.getByTestId('name-line')).toHaveText('Dieser Name ist nicht erlaubt.');
  const fresh = `Uhu ${stamp}`;
  await input.fill(fresh);
  await expect(field.getByTestId('name-line')).toHaveText('Der Name ist frei.');
  await friend.getByRole('button', { name: 'Namen speichern' }).click();
  await expect(plate).toContainText(fresh);
  await expect(plate).not.toContainText('Neuen Namen wählen');
});
