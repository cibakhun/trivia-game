import { useRoute } from './router.ts';
import { AccountScreen } from './screens/AccountScreen.tsx';
import { ChallengeScreen } from './screens/ChallengeScreen.tsx';
import { JoinScreen } from './screens/JoinScreen.tsx';
import { MatchesScreen } from './screens/MatchesScreen.tsx';
import { MatchScreen } from './screens/MatchScreen.tsx';
import { PlayScreen } from './screens/PlayScreen.tsx';
import { StartScreen } from './screens/StartScreen.tsx';
import { WorldsScreen } from './screens/WorldsScreen.tsx';
import { useSession } from './session.tsx';

export function App() {
  const route = useRoute();
  const { state } = useSession();
  // Der Einladungslink gilt auch ohne Sitzung: Die Seite legt auf Wunsch ein Gastkonto an
  if (route.name === 'matchJoin') return <JoinScreen key={route.code} code={route.code} />;
  // Ohne Sitzung führt jeder andere Pfad zum Start (Gastkonto anlegen oder anmelden)
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
    case 'matches':
      return <MatchesScreen />;
    case 'match':
      return <MatchScreen key={route.matchId} matchId={route.matchId} />;
  }
}
