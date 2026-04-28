import 'dotenv/config';

function required(key: string): string {
  const val = process.env[key];
  if (!val) {
    console.error(`FATAL: missing required env var: ${key}`);
    process.exit(1);
  }
  return val;
}

export const config = {
  port: parseInt(process.env.PORT ?? '3002', 10),
  backendUrl: required('BACKEND_URL'),
  internalApiKey: required('INTERNAL_API_KEY'),
  jwtSecret: process.env.JWT_SECRET ?? '',
  // Big Fish: 30 players, 15-minute matches
  maxPlayersPerRoom: parseInt(process.env.MAX_PLAYERS ?? '30', 10),
  matchDurationMs: parseInt(process.env.MATCH_DURATION_MS ?? '900000', 10),
};
