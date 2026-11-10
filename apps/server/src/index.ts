export { buildApp, type BuildAppOptions } from './app.ts';
export type { AppContext } from './context.ts';
export { parseServerConfig, type ServerConfig } from './infra/config.ts';
export {
  createWorld,
  type CreateWorldOptions,
  type CreatedWorld,
} from './modules/world/create-world.ts';
export {
  expireStaleChallenges,
  settleOpenSiegesOfUser,
  startChallengeSweeper,
} from './modules/combat/sweeper.ts';
export {
  ACCOUNT_REFERENCES,
  cleanupAccounts,
  deleteAccount,
  GUEST_INACTIVITY_MS,
} from './modules/identity/deletion.ts';
export { matchContextFrom, type MatchContext } from './modules/match/context.ts';
export { advanceMatch, runMatchDriverOnce, startMatchDriver } from './modules/match/driver.ts';
export { expireLobbies, LOBBY_TTL_MS } from './modules/match/lobby.ts';
