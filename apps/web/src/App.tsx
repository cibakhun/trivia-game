import { SessionFlashNote } from './components/SessionFlash.tsx';
import { MenuScreen } from './menu/MenuScreen.tsx';
import { useRoute } from './router.ts';
import { ChallengeScreen } from './screens/ChallengeScreen.tsx';
import { JoinScreen } from './screens/JoinScreen.tsx';
import { MatchScreen } from './screens/MatchScreen.tsx';
import { PlayScreen } from './screens/PlayScreen.tsx';
import { VerifyEmailScreen } from './screens/VerifyEmailScreen.tsx';
import { WorldsScreen } from './screens/WorldsScreen.tsx';
import { useSession } from './session.tsx';

export function App() {
  return (
    <>
      <Screen />
      <SessionFlashNote />
    </>
  );
}

function Screen() {
  const route = useRoute();
  const { state } = useSession();
  // Der Einladungslink gilt auch ohne Sitzung: Die Seite legt auf Wunsch ein Gastkonto an
  if (route.name === 'matchJoin') return <JoinScreen key={route.code} code={route.code} />;
  // Ebenso der Link aus der Bestätigungsmail (ADR-086)
  if (route.name === 'emailVerify')
    return <VerifyEmailScreen key={route.token} token={route.token} />;
  // Ohne Sitzung begrüßt das Hauptmenü (Gastkonto anlegen oder anmelden); das Blatt der Adresse
  // öffnet sich, sobald die Sitzung steht
  if (state.status === 'anonymous') {
    return (
      <MenuScreen
        sheet={route.name === 'menu' ? route.sheet : route.name === 'matches' ? 'new' : null}
      />
    );
  }
  switch (route.name) {
    case 'start':
      return <MenuScreen sheet={null} />;
    case 'matches':
      return <MenuScreen sheet="new" />;
    case 'menu':
      return <MenuScreen sheet={route.sheet} />;
    case 'worlds':
      return <WorldsScreen />;
    case 'account':
      return <MenuScreen sheet="account" accountView={route.view} />;
    case 'play':
      return <PlayScreen key={route.instanceId} instanceId={route.instanceId} />;
    case 'challenge':
      return <ChallengeScreen key={route.challengeId} challengeId={route.challengeId} />;
    case 'match':
      return <MatchScreen key={route.matchId} matchId={route.matchId} />;
  }
}
