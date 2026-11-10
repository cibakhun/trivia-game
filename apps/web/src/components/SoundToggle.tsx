import { useEffect, useState } from 'react';
import {
  onSoundChange,
  playSound,
  setSoundEnabled,
  soundEnabled,
  unlockAudio,
} from '../audio/sound.ts';
import { t } from '../i18n/i18n.ts';

/** Schalter für die Klänge der Partie; der Zustand bleibt im Browser gespeichert. */
export function SoundToggle() {
  const [on, setOn] = useState(soundEnabled);
  useEffect(() => onSoundChange(setOn), []);
  return (
    <button
      type="button"
      className="sound-toggle"
      aria-pressed={on}
      title={on ? t('sound.turnOff') : t('sound.turnOn')}
      onClick={() => {
        unlockAudio();
        setSoundEnabled(!on);
        if (!on) playSound('pick');
      }}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
        <path d="M4 9h4l5-4v14l-5-4H4z" className="speaker" />
        {on ? (
          <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" className="waves" />
        ) : (
          <path d="M16 9l5 6M21 9l-5 6" className="waves" />
        )}
      </svg>
      <span>{t('sound.label')}</span>
    </button>
  );
}
