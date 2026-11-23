import { expect, test } from '@playwright/test';

/**
 * Registrieren (O-03, ADR-082) auf der Kontoseite (ADR-080): Ein Gast tritt bei, öffnet sein
 * Konto und registriert sich mit einem selbst getippten Benutzernamen (Prüfung beim Tippen, Ideen
 * zum Antippen) und Passwort, meldet sich auf einem zweiten Gerät an und findet dort sein Reich
 * wieder. Die Ansichten der Kontoseite haben eigene Pfade; „Zurück“ im Browser schließt sie.
 * Abmelden beendet nur die Sitzung des einen Geräts. Die Weltwahl zeigt die eigene Welt zum
 * Weiterspielen; ins Hauptmenü kommt man ohne Sitzung über „Ich habe ein Konto“.
 */

const PASSWORD = 'e2e-pw7';

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
  // Ein Tippfehler bei der Wiederholung hält auf
  await form.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
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
  await form.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await form.getByLabel('Passwort wiederholen').fill(PASSWORD);
  await form.getByRole('button', { name: 'Registrieren' }).click();
  await expect(nameField.getByLabel('Benutzername')).toBeFocused();
  await expect(page.getByTestId('account-status')).toHaveText('Gast · nicht registriert');
});
