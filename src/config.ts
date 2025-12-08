import dotenv from 'dotenv';

dotenv.config();

export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface MqttConfig {
  host: string;
  port: number;
}

export interface Config {
  port: number;
  db: DbConfig;
  mqtt: MqttConfig;
  controlIntervalSeconds: number;
  feederDefaultLimitKw: number;
  defaultFeederId: string;
  controlParams: {
    globalKwLimit: number;
    minSocReserve: number;
    targetSoc: number;
    respectPriority: boolean;
    socWeight: number;
    allocationMode?: 'heuristic' | 'optimizer';
    optimizer?: {
      enforceTargetSoc?: boolean;
      solverEnabled?: boolean;
    };
  };
  trackingErrorWindowMinutes: number;
  auth: {
    jwtSecret: string;
    tokenTtlHours: number;
    users: {
      username: string;
      password: string;
      role: 'viewer' | 'operator' | 'admin';
    }[];
  };
}

function parseUsers(): Config['auth']['users'] {
  const raw = process.env.AUTH_USERS;
  if (!raw) {
    return [
      { username: 'admin', password: 'admin123', role: 'admin' },
      { username: 'operator', password: 'operator123', role: 'operator' },
      { username: 'viewer', password: 'viewer123', role: 'viewer' },
    ];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (u) => u?.username && u?.password && ['viewer', 'operator', 'admin'].includes(u.role),
      ) as Config['auth']['users'];
    }
  } catch (err) {
    console.warn('[config] Failed to parse AUTH_USERS, falling back to defaults', err);
  }

  return [
    { username: 'admin', password: 'admin123', role: 'admin' },
    { username: 'operator', password: 'operator123', role: 'operator' },
    { username: 'viewer', password: 'viewer123', role: 'viewer' },
  ];
}

const config: Config = {
  port: Number(process.env.PORT ?? 3001),
  db: {
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_NAME ?? 'mini_derms',
  },
  mqtt: {
    host: process.env.MQTT_HOST ?? 'localhost',
    port: Number(process.env.MQTT_PORT ?? 1883),
  },
  controlIntervalSeconds: Number(process.env.CONTROL_INTERVAL_SECONDS ?? 60),
  feederDefaultLimitKw: Number(process.env.FEEDER_DEFAULT_LIMIT_KW ?? 250),
  defaultFeederId: process.env.DEFAULT_FEEDER_ID ?? 'default-feeder',
  controlParams: {
    globalKwLimit: Number(process.env.CONTROL_GLOBAL_KW_LIMIT ?? 250),
    minSocReserve: Number(process.env.CONTROL_MIN_SOC_RESERVE ?? 0.2),
    targetSoc: Number(process.env.CONTROL_TARGET_SOC ?? 0.8),
    respectPriority: (process.env.CONTROL_RESPECT_PRIORITY ?? 'true') === 'true',
    socWeight: Number(process.env.CONTROL_SOC_WEIGHT ?? 1.2),
    allocationMode: (process.env.CONTROL_ALLOCATION_MODE ?? 'heuristic')
      .toLowerCase()
      .startsWith('opt')
      ? 'optimizer'
      : 'heuristic',
    optimizer: {
      enforceTargetSoc:
        (process.env.CONTROL_OPTIMIZER_ENFORCE_TARGET_SOC ?? 'true').toLowerCase() === 'true',
      solverEnabled:
        (process.env.CONTROL_OPTIMIZER_SOLVER_ENABLED ?? 'false').toLowerCase() === 'true',
    },
  },
  trackingErrorWindowMinutes: Number(process.env.TRACKING_ERROR_WINDOW_MINUTES ?? 10),
  auth: {
    jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
    tokenTtlHours: Number(process.env.JWT_TOKEN_TTL_HOURS ?? 12),
    users: parseUsers(),
  },
};

export default config;
