import { useRoute } from './router.ts';
import { AccountScreen } from './screens/AccountScreen.tsx';
import { ChallengeScreen } from './screens/ChallengeScreen.tsx';
import { PlayScreen } from './screens/PlayScreen.tsx';
import { StartScreen } from './screens/StartScreen.tsx';
import { WorldsScreen } from './screens/WorldsScreen.tsx';
import { useSession } from './session.tsx';

export function App() {
  const route = useRoute();
  const { state } = useSession();
  // Ohne Sitzung führt jeder Pfad zum Start (Gastkonto anlegen oder anmelden)
  if (state.status === 'anonymous' || route.name === 'start') return <StartScreen />;
  switch (route.name) {
    case 'worlds':
      return <WorldsScreen />;
    case 'account':
      return <AccountScreen />;
    case 'play':
      return <PlayScreen key={route.instanceId} instanceId={route.instanceId} />;
    case 'challenge':
      return <ChallengeScreen key={route.challengeId} challengeId={route.challengeId} />;
  }
}
