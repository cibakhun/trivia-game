/**
 * Wortfilter für selbst gewählte Namen (ADR-082) [E]: hält grobe Beleidigungen, Obszönes,
 * NS-Bezüge und Namen, die wie die Spielleitung oder ein Bot klingen, aus dem Spiel. Er prüft
 * Deutsch, Englisch und Ungarisch und ist absichtlich klein: Ein Filter lässt sich immer umgehen
 * und trifft manchmal harmlose Namen. Er ersetzt keine Meldefunktion (O-10, Folgepunkt O-48).
 *
 * Verglichen wird eine gefaltete Form: klein, ohne Akzente, ß als ss, Ziffern wahlweise als
 * Buchstaben gelesen (0→o, 1→i, 3→e, 4→a, 5→s, 7→t, 8→b), mit und ohne doppelte Buchstaben
 * („fuuuck“). Vier Listen:
 * - überall in einem Wort oder in einer Kette mit kurzen Wörtern („H.i.t.l.e.r“); lange Wörter
 *   (ab 7 Buchstaben) auch über jede Fuge („Arsch-Loch“),
 * - nur als ganzes Wort (kurze Wörter, die sonst harmlose Namen träfen: „Sex“, aber nicht „Essex“),
 * - Wendungen aus mehreren Wörtern im ganzen Namen („Sieg Heil“),
 * - nur am Anfang (Ämter: „Admin…“, aber nicht „Badminton“).
 */

const ANYWHERE = [
  // Deutsch
  'arschloch',
  'arschgeige',
  'wichser',
  'wixer',
  'hurensohn',
  'hurenkind',
  'hure',
  'fotze',
  'votze',
  'schlampe',
  'missgeburt',
  'spast',
  'schwuchtel',
  'kanake',
  'neger',
  'fick',
  'pimmel',
  'titten',
  'vergewaltig',
  'porno',
  'judensau',
  'saujude',
  // NS-Bezüge
  'hitler',
  'nsdap',
  'holocaust',
  'auschwitz',
  'gaskammer',
  'nazi',
  '1488',
  // Englisch
  'nigger',
  'nigga',
  'fuck',
  'shit',
  'cunt',
  'bitch',
  'whore',
  'slut',
  'rapist',
  'faggot',
  'retard',
  'asshole',
  'pussy',
  'porn',
  'dildo',
  'penis',
  'vagina',
  'kike',
  // Ungarisch
  'kurva',
  'geci',
  'fasz',
  'picsa',
  'buzi',
  'basz',
  'kocsog',
] as const;

const WHOLE_WORD = [
  'sex',
  'rape',
  'fag',
  'cock',
  'anal',
  'anus',
  'kkk',
  'ss',
  'sa',
  'hh',
  '88',
  'kys',
  'szar',
  'anyad',
  // Wie ein Bot oder ein Gast in der Partie
  'bot',
  'gast',
  'guest',
  'mod',
  'gm',
] as const;

/** Wendungen aus mehreren Wörtern, gesucht im ganzen Namen ohne Trennzeichen. */
const PHRASES = ['siegheil', 'heilhitler', 'whitepower', 'whitepride', 'killyourself'] as const;

const AT_START = [
  'admin',
  'moderator',
  'spielleitung',
  'support',
  'system',
  'offiziell',
  'official',
] as const;

const LEET: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
};

/** Klein, ohne Akzente, ß und ähnliche Ligaturen aufgelöst. */
function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/gu, 'ss')
    .replace(/æ/gu, 'ae')
    .replace(/œ/gu, 'oe')
    .replace(/[øđłħŧŋŀı]/gu, (c) => FOLD_SPECIAL[c] ?? c)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '');
}

const FOLD_SPECIAL: Readonly<Record<string, string>> = {
  ø: 'o',
  đ: 'd',
  ł: 'l',
  ħ: 'h',
  ŧ: 't',
  ŋ: 'n',
  ŀ: 'l',
  ı: 'i',
};

function leet(text: string): string {
  return text.replace(/[0134578]/gu, (c) => LEET[c] ?? c);
}

function collapse(text: string): string {
  return text.replace(/(.)\1+/gu, '$1');
}

/** Wörter des Namens: getrennt an „ _.-“ und an Binnenmajuskeln („AnnaZimmer“). */
function words(name: string): string[] {
  return name
    .split(/[ _.-]+|(?<=\p{Ll})(?=\p{Lu})/u)
    .filter((w) => w !== '')
    .map(fold);
}

/**
 * Wörter und Ketten aus Nachbarwörtern, deren Fuge ein kurzes Wort (bis 3 Zeichen) hat: So fällt
 * „H i t l e r“ oder „Hitl er“ auf, „Anna Zimmer“ aber nicht.
 */
function chains(list: readonly string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < list.length; i++) {
    let chain = list[i] ?? '';
    result.push(chain);
    for (let j = i + 1; j < list.length; j++) {
      const left = list[j - 1] ?? '';
      const right = list[j] ?? '';
      if (left.length > 3 && right.length > 3) break;
      chain += right;
      result.push(chain);
    }
  }
  return result;
}

/** Darf der (schon vereinheitlichte und auf Regeln geprüfte) Name ins Spiel? */
export function nameAllowed(name: string): boolean {
  const plain = words(name);
  for (const list of [plain, plain.map(leet)]) {
    for (const chain of chains(list)) {
      const squeezed = collapse(chain);
      for (const bad of ANYWHERE) {
        if (chain.includes(bad) || squeezed.includes(collapse(bad))) return false;
      }
    }
    // Eine reine Zahl gilt als ganzes Wort nur so, wie sie dasteht: „88“ ja, „54“ ist keine „SA“
    const wholeWord = list.some(
      (w, i) =>
        (WHOLE_WORD as readonly string[]).includes(w) &&
        (list === plain || /\p{L}/u.test(plain[i] ?? '')),
    );
    if (wholeWord) return false;
    const joined = list.join('');
    const squeezedAll = collapse(joined);
    for (const bad of ANYWHERE) {
      if (bad.length >= 7 && squeezedAll.includes(collapse(bad))) return false;
    }
    if (PHRASES.some((phrase) => squeezedAll.includes(collapse(phrase)))) return false;
    if (AT_START.some((word) => joined.startsWith(word))) return false;
  }
  return true;
}
