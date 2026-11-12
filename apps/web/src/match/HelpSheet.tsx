import { useEffect, useRef, type ReactNode } from 'react';
import { MarkIcon } from '../art/RealmIcons.tsx';
import { SeatCrest } from '../art/SeatCrest.tsx';
import { Swords } from '../art/Swords.tsx';
import { t, tp } from '../i18n/i18n.ts';

/**
 * „So geht's“: ein Blatt mit vier Bildern, das Ziel und Ablauf der Partie mit Ausbau erklärt (Ziel,
 * Rüsten, Angreifen, Duell). Es liegt über der ganzen Bühne und öffnet sich vor der ersten Partie
 * von selbst; danach erreicht man es über „?“ links unten und in der Aufstellung. Während einer
 * laufenden Frage ist es zu (RealmStage). Die Zahlen kommen aus den Regeln der Partie. „Alles klar“
 * schließt es, an der Tastatur auch Escape.
 */

const STORAGE_KEY = 'rdw.help.realm';

/** Hat dieses Gerät „So geht's“ schon gezeigt? Ohne Speicher gilt: ja, damit es nie stört. */
export function helpSeen(): boolean {
  try {
    const store = globalThis.localStorage;
    return store ? store.getItem(STORAGE_KEY) === 'seen' : true;
  } catch {
    return true;
  }
}

export function markHelpSeen(): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, 'seen');
  } catch {
    // Kein Speicher (privates Fenster): Dann fragt die nächste Partie eben noch einmal
  }
}

/** Wert eines Felds, wie er auf der Karte steht. */
function Coin({ value }: { readonly value: number }) {
  return <span className="help-coin">{value}</span>;
}

/** Kleines Glücksrad: sechs Felder, drei davon in der eigenen Farbe, der Zeiger oben. */
function MiniWheel() {
  const spokes = [0, 60, 120, 180, 240, 300];
  return (
    <svg className="help-wheel" viewBox="-26 -30 52 56" aria-hidden="true" focusable="false">
      <circle r="23" className="help-wheel-rim" />
      {spokes.map((angle, index) => (
        <path
          key={angle}
          d="M0 0L0 -20A20 20 0 0 1 17.32 -10Z"
          transform={`rotate(${angle})`}
          className={index % 2 === 0 ? 'help-wheel-mine' : 'help-wheel-free'}
        />
      ))}
      <circle r="4" className="help-wheel-hub" />
      <path d="M-5 -30L5 -30L0 -19Z" className="help-wheel-pointer" />
    </svg>
  );
}

function Card({
  step,
  title,
  art,
  children,
}: {
  readonly step: number;
  readonly title: string;
  readonly art: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <li className="help-card">
      <div className="help-art" aria-hidden="true">
        {art}
      </div>
      <h3>
        <span className="help-step">{step}</span>
        {title}
      </h3>
      <p>{children}</p>
    </li>
  );
}

export function HelpSheet({
  attackNeedsArmy = null,
  rounds,
  castleLives,
  fieldValue,
  castleValue,
  onClose,
}: {
  /** Regel der Partie zum Angriff nur mit Armee (ADR-064); `null`: Die Grenze genügt. */
  readonly attackNeedsArmy?: 'ALWAYS' | 'RIVALS' | null;
  /** Feldzugrunden der Partie. */
  readonly rounds: number;
  readonly castleLives: number;
  readonly fieldValue: number;
  readonly castleValue: number;
  readonly onClose: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  // Die Bühne übergibt bei jeder Abfrage eine neue Funktion: Der Fokus soll dabei nicht springen
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    // Der Fokus geht ins Blatt und bleibt dort; beim Schließen kehrt er zum Auslöser zurück (beim
    // ersten Öffnen von selbst gibt es keinen)
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current();
      else if (event.key === 'Tab') {
        // „Alles klar“ ist der einzige Knopf im Blatt: Tab wandert nicht auf die Bühne dahinter
        event.preventDefault();
        closeButton.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return (
    <div
      className="stage-help"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-title"
      data-testid="match-help"
    >
      <section className="sheet help">
        <header className="help-head">
          <h2 id="help-title">{t('realm.help.title')}</h2>
          <button
            ref={closeButton}
            type="button"
            className="button button-primary help-close"
            data-testid="match-help-close"
            onClick={onClose}
          >
            {t('realm.help.close')}
          </button>
        </header>
        <ol className="help-cards">
          <Card
            step={1}
            title={t('realm.help.goal.title')}
            art={
              <>
                <Coin value={fieldValue} />
                <Coin value={fieldValue} />
                <span className="help-castle">
                  <MarkIcon kind="castle" size={30} />
                  <Coin value={castleValue} />
                </span>
              </>
            }
          >
            {tp('realm.help.goal.text', rounds, { field: fieldValue, castle: castleValue })}
          </Card>
          <Card
            step={2}
            title={t('realm.help.prepare.title')}
            art={
              <>
                <MarkIcon kind="bread" size={24} />
                <MarkIcon kind="material" size={24} />
                <span className="help-arrow">→</span>
                <MarkIcon kind="village" size={28} />
                <MarkIcon kind="army" size={26} />
              </>
            }
          >
            {t('realm.help.prepare.text')}
          </Card>
          <Card
            step={3}
            title={t('realm.help.attack.title')}
            art={
              <>
                <MarkIcon kind="army" size={24} />
                <MarkIcon kind="army" size={24} />
                <span className="help-arrow">→</span>
                <MiniWheel />
              </>
            }
          >
            {t(
              attackNeedsArmy === 'ALWAYS'
                ? 'realm.help.attack.textArmy'
                : attackNeedsArmy === 'RIVALS'
                  ? 'realm.help.attack.textRivals'
                  : 'realm.help.attack.text',
            )}
          </Card>
          <Card
            step={4}
            title={t('realm.help.duel.title')}
            art={
              <>
                <SeatCrest seat={2} size={30} />
                <Swords size={26} />
                <SeatCrest seat={1} size={30} />
              </>
            }
          >
            {tp('realm.help.duel.text', castleLives)}
          </Card>
        </ol>
      </section>
    </div>
  );
}
