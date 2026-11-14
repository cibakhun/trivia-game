import {
  expect,
  type Browser,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { showEstimate } from '../src/match/estimate-input.ts';
import { matchSolution } from './answers.ts';

/**
 * Handgriffe der Partie-Tests im Browser, für beide Spielarten: Gast anlegen, die erste markierte
 * Region wählen und eine Frage richtig beantworten. Die Lösung liest nur der Test aus der
 * Datenbank.
 */

/** Gast anlegen und zur Partie-Übersicht gehen. */
export async function newPlayer(
  browser: Browser,
  context: BrowserContextOptions = {},
): Promise<Page> {
  const page = await (await browser.newContext(context)).newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Als Gast spielen' }).click();
  await page.getByRole('button', { name: 'Partie spielen' }).click();
  await expect(page).toHaveURL(/\/partie$/);
  return page;
}

export function matchIdOf(page: Page): string {
  return new URL(page.url()).pathname.split('/').at(-1) ?? '';
}

/** `true`, wenn die Aktion gelang; ein Fehlschlag heißt hier: der Schritt war schon vorbei. */
export async function succeeds(action: Promise<unknown>): Promise<boolean> {
  return action.then(
    () => true,
    () => false,
  );
}

/**
 * Wählt die erste markierte Region. Zählt nur, wenn die Wahl beim Server ankommt: Liegt etwas über
 * der Region und schluckt den Tipp, wählt der Server nach Ablauf der Zeit zufällig.
 */
export async function pickFirst(
  page: Page,
  matchId: string,
  how: 'click' | 'tap',
): Promise<boolean> {
  const region = page.getByTestId('match-board').getByRole('button').first();
  const accepted = page
    .waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith(`/matches/${matchId}/pick`),
      { timeout: 2_000 },
    )
    .then(
      (r) => r.ok(),
      () => false,
    );
  // Kommt die Abfrage dazwischen, ist die Wahl vielleicht schon vorbei: dann neu lesen
  const done = await succeeds(
    how === 'tap' ? region.tap({ timeout: 2_000 }) : region.click({ timeout: 2_000 }),
  );
  return (await accepted) && done;
}

/**
 * Ob der Server die Antwort auf Frage `seq` annimmt. Vor dem Tipp aufrufen: Ein gelungener Tipp
 * allein heißt nicht, dass die Antwort zählt.
 */
export function answerAccepted(page: Page, matchId: string, seq: number): Promise<boolean> {
  return page
    .waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        r.url().endsWith(`/matches/${matchId}/questions/${seq}/answer`),
      { timeout: 10_000 },
    )
    .then(
      (r) => r.ok(),
      () => false,
    );
}

/**
 * Beantwortet die Frage `seq` richtig. `false` heißt: Die Frage war inzwischen vorbei. Eine
 * Schätzung steht in der Fragekarte auf der Karte; getippt wird am Handy auf dem Ziffernfeld im
 * Blatt, am Rechner mit der Tastatur (ADR-059).
 */
export async function answerRight(
  page: Page,
  matchId: string,
  seq: number,
  how: 'click' | 'tap' = 'click',
): Promise<boolean> {
  const solution = await matchSolution(matchId, seq);
  const press = (button: Locator) =>
    how === 'tap' ? button.tap({ timeout: 5_000 }) : button.click({ timeout: 5_000 });
  if (solution.kind === 'TRIVIA') {
    const accepted = answerAccepted(page, matchId, seq);
    const chosen = await succeeds(
      press(
        page
          .getByTestId('match-question')
          .getByRole('button', { name: solution.optionText, exact: true }),
      ),
    );
    return chosen && (await accepted);
  }
  const pad = page.getByTestId('match-answering');
  const value = page.getByTestId('estimate-value');
  const key = (name: string) => press(pad.getByRole('button', { name, exact: true }));
  const typed = await succeeds(
    (async () => {
      // Steht von einem abgebrochenen Versuch noch etwas da, erst leeren
      const before = (await value.textContent({ timeout: 5_000 })) ?? '';
      const left = before.replace(/[^\d,]/g, '').length;
      for (let i = 0; i < left; i++) await key('Letzte Ziffer löschen');
      if (how === 'tap') {
        for (const char of solution.input) await key(char === ',' ? 'Komma' : char);
      } else {
        await page.keyboard.type(solution.input);
      }
    })(),
  );
  if (!typed) return false;
  // Keine Ziffer darf verloren gehen: Die Karte zeigt genau die getippte Zahl
  const text = await value.textContent({ timeout: 1_000 }).catch(() => null);
  if (text !== null && text !== showEstimate(solution.input)) {
    throw new Error(`Die Fragekarte zeigt „${text}“ statt „${showEstimate(solution.input)}“`);
  }
  const accepted = answerAccepted(page, matchId, seq);
  return (await succeeds(key('Antwort abgeben'))) && (await accepted);
}

/** Abbild eines Blatts, das eben von der Mitte der Karte ging (`StageCentre`, ADR-070). */
export interface SheetGhost {
  /** Wie es geht: `turn` (dreht sich weg) oder `lift` (hebt sich ab), siehe `sheetSwap`. */
  readonly leave: string;
  /** Kennungen im Abbild (`data-testid`, `id`): Es darf keine tragen. */
  readonly marks: number;
  /** Das neue Blatt weiß, dass es hereingedreht kommt. */
  readonly turned: boolean;
}

/**
 * Lässt die Seite jedes Abbild mitschreiben, sobald es erscheint: Es steht nur 0,13 bis 0,18 s, zu
 * kurz für eine Abfrage von außen. Gilt für die Seite, wie sie steht, und nach jedem Neuladen.
 */
export async function recordGhosts(page: Page): Promise<void> {
  const record = () => {
    const ghosts: SheetGhost[] = [];
    (window as unknown as { ghosts: SheetGhost[] }).ghosts = ghosts;
    new MutationObserver((records) => {
      for (const { addedNodes } of records) {
        for (const node of addedNodes) {
          if (!(node instanceof Element) || !node.classList.contains('sheet-ghost')) continue;
          ghosts.push({
            leave: [...node.classList].find((c) => c.startsWith('leave-'))?.slice(6) ?? '',
            marks: node.querySelectorAll('[data-testid], [id]').length,
            turned: document.querySelector('.stage-centre.turned') !== null,
          });
        }
      }
    }).observe(document, { subtree: true, childList: true });
  };
  await page.addInitScript(record);
  await page.evaluate(record);
}

export function ghostsBy(page: Page): Promise<SheetGhost[]> {
  return page.evaluate(() => (window as unknown as { ghosts?: SheetGhost[] }).ghosts ?? []);
}
