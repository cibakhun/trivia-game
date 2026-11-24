import { useEffect, useRef, useState } from 'react';
import { t, tp } from '../i18n/i18n.ts';

/**
 * Restzeit einer Frage. Grundlage ist `remainingMs` vom Server und die monotone Uhr des Browsers
 * (`performance.now()`), nie die Systemuhr (API.md §1, Zeit).
 */
export function Countdown({
  deadline,
  totalMs,
  onExpire,
  quiet = false,
  brief = false,
  calm = false,
}: {
  /** Ende als `performance.now()`-Wert. */
  readonly deadline: number;
  readonly totalMs: number;
  readonly onExpire: () => void;
  /** Nur ein schmaler Balken ohne Text und ohne Warnfarbe: für Pausen, in denen nichts zu tun ist. */
  readonly quiet?: boolean;
  /** Nur die Sekunden als Zahl (Bühne der Partie); der ganze Satz bleibt für Screenreader. */
  readonly brief?: boolean;
  /**
   * Ohne Warnfarbe, aber mit Zahl: Wer eine Frage nur mitliest, steht nicht unter Zeitdruck. Die
   * Zahl sagt ihm, wann die Antworten kommen.
   */
  readonly calm?: boolean;
}) {
  const [remaining, setRemaining] = useState(() => Math.max(0, deadline - performance.now()));
  const expired = useRef(false);
  const expire = useRef(onExpire);
  expire.current = onExpire;

  useEffect(() => {
    expired.current = false;
    const tick = () => {
      const left = Math.max(0, deadline - performance.now());
      setRemaining(left);
      if (left === 0 && !expired.current) {
        expired.current = true;
        expire.current();
      }
    };
    tick();
    const timer = setInterval(tick, 200);
    return () => clearInterval(timer);
  }, [deadline]);

  // Die Frist enthält eine kleine Latenzzugabe (QUIZ_ENGINE §6); angezeigt wird nur das Zeitlimit.
  const shown = Math.min(remaining, totalMs);
  const seconds = Math.ceil(shown / 1000);
  const share = totalMs > 0 ? shown / totalMs : 0;
  const urgent = !quiet && !calm && seconds <= 5;
  return (
    <div
      className={`countdown${quiet ? ' quiet' : ''}${calm ? ' calm' : ''}`}
      role="timer"
      aria-live="off"
    >
      <div className="countdown-bar" aria-hidden="true">
        <span style={{ width: `${share * 100}%` }} className={urgent ? 'urgent' : ''} />
      </div>
      {brief && !quiet ? (
        <span className={`countdown-seconds${urgent ? ' urgent' : ''}`} aria-hidden="true">
          {seconds}
        </span>
      ) : null}
      <span className={quiet || brief ? 'visually-hidden' : 'countdown-text'}>
        {seconds > 0 ? tp('quiz.remaining', seconds) : t('quiz.timeUp')}
      </span>
    </div>
  );
}
