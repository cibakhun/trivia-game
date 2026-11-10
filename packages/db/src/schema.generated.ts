// Automatisch erzeugt von `pnpm db:types` (packages/db/src/codegen.ts) – nicht von Hand ändern.
// Ein Integrationstest vergleicht diese Datei mit dem Schema einer frisch migrierten Datenbank.
// ColumnType<Lesen, Einfügen, Ändern>; „| undefined“ beim Einfügen: Die Spalte hat einen Standardwert.
import type { ColumnType } from 'kysely';

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface BattleEventsTable {
  id: ColumnType<string, never, never>;
  siege_id: string;
  seq: number;
  type: string;
  payload: ColumnType<JsonValue, string | undefined, string>;
  at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface BattleResultsTable {
  siege_id: string;
  winner_role: string | null;
  reason: string;
  attacker_summary: ColumnType<JsonValue, string, string>;
  defender_summary: ColumnType<JsonValue, string, string>;
  defended: ColumnType<boolean, boolean | undefined, boolean>;
  defense_points: ColumnType<number, number | undefined, number>;
  decided_at: ColumnType<Date, Date | string | undefined, Date | string>;
  core_version: string;
}

export interface GameClockTable {
  id: number;
  offset: ColumnType<object, string | undefined, string>;
}

export interface IdempotencyKeysTable {
  user_id: string;
  key: string;
  endpoint: string;
  request_hash: string;
  response_status: number;
  response_body: ColumnType<JsonValue, string, string>;
  created_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface KingdomHistoryTable {
  id: ColumnType<string, never, never>;
  kingdom_id: string;
  kind: string;
  payload: ColumnType<JsonValue, string | undefined, string>;
  at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface KingdomStatisticsTable {
  kingdom_id: string;
  max_regions: ColumnType<number, number | undefined, number>;
  npc_regions_conquered: ColumnType<number, number | undefined, number>;
  pvp_won: ColumnType<number, number | undefined, number>;
  pvp_lost: ColumnType<number, number | undefined, number>;
  defenses_won: ColumnType<number, number | undefined, number>;
  defenses_lost: ColumnType<number, number | undefined, number>;
  defense_points: ColumnType<number, number | undefined, number>;
  timeout_losses: ColumnType<number, number | undefined, number>;
  longest_connected: ColumnType<number, number | undefined, number>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface KingdomsTable {
  id: string;
  instance_id: string;
  kind: string;
  owner_user_id: string | null;
  npc_faction_id: string | null;
  name_parts: ColumnType<JsonValue, string, string>;
  color: number;
  status: ColumnType<string, string | undefined, string>;
  region_count: ColumnType<number, number | undefined, number>;
  protected_until: ColumnType<Date | null, Date | string | null, Date | string | null>;
  protection_reason: string | null;
  generation: ColumnType<number, number | undefined, number>;
  founded_at: ColumnType<Date, Date | string | undefined, Date | string>;
  fallen_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  version: ColumnType<string, string | number | bigint | undefined, string | number | bigint>;
}

export interface NpcFactionsTable {
  id: string;
  instance_id: string;
  name_key: string;
  archetype: string;
  profile_id: string;
  aggression: ColumnType<string, string | number, string | number>;
  expansion: ColumnType<string, string | number, string | number>;
  status: ColumnType<string, string | undefined, string>;
  home_chunk_x: number;
  home_chunk_y: number;
}

export interface NpcProfilesTable {
  id: string;
  code: string;
  version: number;
  skill_theta: ColumnType<string, string | number, string | number>;
  estimate_spread: ColumnType<JsonValue, string, string>;
  rt_log_mu: ColumnType<string, string | number, string | number>;
  rt_log_sigma: ColumnType<string, string | number, string | number>;
  created_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface PlayerProfilesTable {
  user_id: string;
  display_name: string;
  name_seed: number;
  cosmetic_avatar: string | null;
  created_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface PlayerQuestionExposureTable {
  user_id: string;
  question_id: string;
  last_seen_at: ColumnType<Date, Date | string, Date | string>;
  times: ColumnType<number, number | undefined, number>;
}

export interface PlayerSettingsTable {
  user_id: string;
  locale: ColumnType<string, string | undefined, string>;
  timezone: ColumnType<string, string | undefined, string>;
  auto_extend_enabled: ColumnType<boolean, boolean | undefined, boolean>;
  auto_extend_priorities: ColumnType<JsonValue, string | undefined, string>;
  notification_prefs: ColumnType<JsonValue, string | undefined, string>;
}

export interface PlayerStatisticsTable {
  user_id: string;
  battles: ColumnType<number, number | undefined, number>;
  battles_won: ColumnType<number, number | undefined, number>;
  defenses: ColumnType<number, number | undefined, number>;
  defenses_won: ColumnType<number, number | undefined, number>;
  conquests: ColumnType<number, number | undefined, number>;
  regions_max: ColumnType<number, number | undefined, number>;
  defense_points: ColumnType<number, number | undefined, number>;
  trivia_answered: ColumnType<number, number | undefined, number>;
  trivia_correct: ColumnType<number, number | undefined, number>;
  skill_rating: ColumnType<string, string | number | undefined, string | number>;
  skill_rd: ColumnType<string, string | number | undefined, string | number>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface QuestionOptionsTable {
  version_id: string;
  option_key: string;
  is_correct: boolean;
}

export interface QuestionReviewsTable {
  id: string;
  version_id: string;
  kind: string;
  locale: string | null;
  reviewer_name: string;
  reviewed_on: string;
  notes: string | null;
}

export interface QuestionTranslationsTable {
  version_id: string;
  locale: string;
  prompt: string;
  option_texts: ColumnType<JsonValue | null, string | null, string | null>;
  unit_label: string | null;
  explanation: string | null;
  status: ColumnType<string, string | undefined, string>;
}

export interface QuestionVersionsTable {
  id: string;
  question_id: string;
  version: number;
  kind: string;
  difficulty: number;
  calibrated_difficulty: ColumnType<string | null, string | number | null, string | number | null>;
  answer_value: ColumnType<string | null, string | number | null, string | number | null>;
  answer_precision: number | null;
  answer_unit: string | null;
  input_min: ColumnType<string | null, string | number | null, string | number | null>;
  input_max: ColumnType<string | null, string | number | null, string | number | null>;
  estimate_scale_type: string | null;
  estimate_scale: ColumnType<string | null, string | number | null, string | number | null>;
  sources: ColumnType<JsonValue, string, string>;
  status: ColumnType<string, string | undefined, string>;
  approved_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  content_hash: string;
  created_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface QuestionsTable {
  id: string;
  key: string;
  kind: string;
  category: string;
  status: ColumnType<string, string | undefined, string>;
  current_version_id: string | null;
  tags: ColumnType<string[], string[] | undefined, string[]>;
  origin: string;
  license_note: string | null;
  is_fixture: ColumnType<boolean, boolean | undefined, boolean>;
  created_by: string | null;
  created_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface QuizAnswersTable {
  id: string;
  challenge_id: string;
  siege_id: string;
  participant_id: string;
  step_index: number;
  locale: string | null;
  presentation: ColumnType<JsonValue | null, string | null, string | null>;
  presented_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  answer_deadline_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  received_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  answer_option_key: string | null;
  answer_value: ColumnType<string | null, string | number | null, string | number | null>;
  raw_input: string | null;
  client_elapsed_ms: number | null;
  rtt_ms: number | null;
  server_elapsed_ms: number | null;
  effective_ms: number | null;
  is_correct: boolean | null;
  distance: ColumnType<string | null, string | number | null, string | number | null>;
  status: string;
  idempotency_key: string | null;
  audit: ColumnType<JsonValue | null, string | null, string | null>;
  created_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface QuizChallengeStepsTable {
  challenge_id: string;
  step_index: number;
  kind: string;
  version_id: string;
  time_limit_ms: number;
}

export interface QuizChallengesTable {
  id: string;
  siege_id: string;
  created_at: ColumnType<Date, Date | string | undefined, Date | string>;
  target_difficulty: ColumnType<string, string | number, string | number>;
  rng_key_id: string;
  rng_version: number;
}

export interface RegionHistoryTable {
  id: ColumnType<string, never, never>;
  region_id: ColumnType<string, string | number | bigint, string | number | bigint>;
  instance_id: string;
  from_kingdom_id: string | null;
  to_kingdom_id: string | null;
  cause: string;
  siege_id: string | null;
  at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface RegionStateTable {
  region_id: ColumnType<string, string | number | bigint, string | number | bigint>;
  instance_id: string;
  chunk_x: number;
  chunk_y: number;
  owner_kingdom_id: string | null;
  is_capital: ColumnType<boolean, boolean | undefined, boolean>;
  owned_since: ColumnType<Date | null, Date | string | null, Date | string | null>;
  protected_until: ColumnType<Date | null, Date | string | null, Date | string | null>;
  protection_reason: string | null;
  active_siege_id: string | null;
  version: ColumnType<string, string | number | bigint | undefined, string | number | bigint>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface RegionsTable {
  id: ColumnType<string, never, never>;
  instance_id: string;
  q: number;
  r: number;
  chunk_x: number;
  chunk_y: number;
  biome: number;
  tier: number;
  strategic_value: ColumnType<number, number | undefined, number>;
  province_id: string | null;
}

export interface SeasonResultsTable {
  instance_id: string;
  user_id: string;
  kingdom_id: string;
  rank: number;
  score: number;
  details: ColumnType<JsonValue, string | undefined, string>;
}

export interface SessionsTable {
  token_hash: Buffer;
  user_id: string;
  created_at: ColumnType<Date, Date | string | undefined, Date | string>;
  expires_at: ColumnType<Date, Date | string, Date | string>;
  last_used_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
}

export interface SiegeParticipantsTable {
  id: string;
  siege_id: string;
  role: string;
  user_id: string | null;
  npc_profile_id: string | null;
  locale: string | null;
}

export interface SiegesTable {
  id: string;
  instance_id: string;
  mode: string;
  target_region_id: ColumnType<string, string | number | bigint, string | number | bigint>;
  attacker_kingdom_id: string;
  defender_kingdom_id: string | null;
  defender_kind: string;
  status: string;
  created_at: ColumnType<Date, Date | string | undefined, Date | string>;
  attack_presented_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  opened_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  base_deadline_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  deadline_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  max_deadline_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  defense_started_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  resolved_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  outcome: string | null;
  outcome_reason: string | null;
  rules_snapshot: ColumnType<JsonValue, string, string>;
  version: ColumnType<number, number | undefined, number>;
  idempotency_key: string;
}

export interface UsersTable {
  id: string;
  email: string | null;
  email_verified_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  password_hash: string | null;
  is_guest: boolean;
  role: ColumnType<string, string | undefined, string>;
  created_at: ColumnType<Date, Date | string | undefined, Date | string>;
  last_seen_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  guest_bootstrap_hash: Buffer | null;
  deletion_requested_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  deleted_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
}

export interface WorldEventsTable {
  id: ColumnType<string, never, never>;
  instance_id: string;
  seq: ColumnType<string, string | number | bigint, string | number | bigint>;
  chunk_x: number | null;
  chunk_y: number | null;
  user_id: string | null;
  type: string;
  payload: ColumnType<JsonValue, string | undefined, string>;
  created_at: ColumnType<Date, Date | string | undefined, Date | string>;
}

export interface WorldInstancesTable {
  id: string;
  world_id: string;
  season_id: string | null;
  rules_id: string;
  map_seed: ColumnType<string, string | number | bigint, string | number | bigint>;
  capacity: number;
  status: ColumnType<string, string | undefined, string>;
  starts_at: ColumnType<Date, Date | string, Date | string>;
  ends_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  closed_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
  event_seq: ColumnType<string, string | number | bigint | undefined, string | number | bigint>;
}

export interface WorldParticipantsTable {
  instance_id: string;
  user_id: string;
  joined_at: ColumnType<Date, Date | string | undefined, Date | string>;
  status: ColumnType<string, string | undefined, string>;
  current_kingdom_id: string | null;
  last_active_at: ColumnType<Date | null, Date | string | null, Date | string | null>;
}

export interface WorldRulesTable {
  id: string;
  world_id: string;
  version: number;
  config: ColumnType<JsonValue, string, string>;
  config_hash: string;
  created_by: string | null;
  created_at: ColumnType<Date, Date | string | undefined, Date | string>;
  notes: string | null;
}

export interface WorldSeasonsTable {
  id: string;
  world_id: string;
  period_key: string;
  starts_at: ColumnType<Date, Date | string, Date | string>;
  ends_at: ColumnType<Date, Date | string, Date | string>;
  pvp_cutoff_at: ColumnType<Date, Date | string, Date | string>;
  status: ColumnType<string, string | undefined, string>;
}

export interface WorldsTable {
  id: string;
  slug: string;
  mode: string;
  name_key: string;
  status: ColumnType<string, string | undefined, string>;
  current_rules_id: string | null;
}

export interface Database {
  battle_events: BattleEventsTable;
  battle_results: BattleResultsTable;
  game_clock: GameClockTable;
  idempotency_keys: IdempotencyKeysTable;
  kingdom_history: KingdomHistoryTable;
  kingdom_statistics: KingdomStatisticsTable;
  kingdoms: KingdomsTable;
  npc_factions: NpcFactionsTable;
  npc_profiles: NpcProfilesTable;
  player_profiles: PlayerProfilesTable;
  player_question_exposure: PlayerQuestionExposureTable;
  player_settings: PlayerSettingsTable;
  player_statistics: PlayerStatisticsTable;
  question_options: QuestionOptionsTable;
  question_reviews: QuestionReviewsTable;
  question_translations: QuestionTranslationsTable;
  question_versions: QuestionVersionsTable;
  questions: QuestionsTable;
  quiz_answers: QuizAnswersTable;
  quiz_challenge_steps: QuizChallengeStepsTable;
  quiz_challenges: QuizChallengesTable;
  region_history: RegionHistoryTable;
  region_state: RegionStateTable;
  regions: RegionsTable;
  season_results: SeasonResultsTable;
  sessions: SessionsTable;
  siege_participants: SiegeParticipantsTable;
  sieges: SiegesTable;
  users: UsersTable;
  world_events: WorldEventsTable;
  world_instances: WorldInstancesTable;
  world_participants: WorldParticipantsTable;
  world_rules: WorldRulesTable;
  world_seasons: WorldSeasonsTable;
  worlds: WorldsTable;
}
