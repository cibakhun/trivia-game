import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { installAudioUnlock } from './audio/sound.ts';
import { CrashBoundary } from './components/CrashBoundary.tsx';
import { t } from './i18n/i18n.ts';
import { SessionProvider } from './session.tsx';
import '@fontsource/alegreya/latin-500.css';
import '@fontsource/alegreya/latin-700.css';
import '@fontsource/alegreya/latin-800.css';
import '@fontsource/alegreya-sans/latin-400.css';
import '@fontsource/alegreya-sans/latin-500.css';
import '@fontsource/alegreya-sans/latin-700.css';
import '@fontsource/alegreya-sans/latin-800.css';
import './theme.css';
import './styles.css';

document.title = t('app.title');
installAudioUnlock();
const root = document.getElementById('root');
if (!root) throw new Error('#root fehlt');
createRoot(root).render(
  <StrictMode>
    <CrashBoundary>
      <SessionProvider>
        <App />
      </SessionProvider>
    </CrashBoundary>
  </StrictMode>,
);
