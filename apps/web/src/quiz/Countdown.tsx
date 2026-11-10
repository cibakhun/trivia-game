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
}: {
  /** Ende als `performance.now()`-Wert. */
  readonly deadline: number;
  readonly totalMs: number;
  readonly onExpire: () => void;
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
  return (
    <div className="countdown" role="timer" aria-live="off">
      <div className="countdown-bar" aria-hidden="true">
        <span style={{ width: `${share * 100}%` }} className={seconds <= 5 ? 'urgent' : ''} />
      </div>
      <span className="countdown-text">
        {seconds > 0 ? tp('quiz.remaining', seconds) : t('quiz.timeUp')}
      </span>
    </div>
  );
}
