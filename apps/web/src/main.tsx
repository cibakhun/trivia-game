import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
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
const root = document.getElementById('root');
if (!root) throw new Error('#root fehlt');
createRoot(root).render(
  <StrictMode>
    <SessionProvider>
      <App />
    </SessionProvider>
  </StrictMode>,
);
