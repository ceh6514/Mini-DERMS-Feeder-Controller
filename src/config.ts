import dotenv from 'dotenv';
import { isValidPasswordHash } from './security/passwords';

dotenv.config();

const weakPasswords = new Set([
  'admin123',
  'administrator',
  'changeme',
  'change-me',
  'default',
  'operator123',
  'password',
  'postgres',
  'viewer123',
]);

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
  topicPrefix: string;
}

export interface Config {
  port: number;
  logLevel: string;
  logPretty: boolean;
  db: DbConfig;
  mqtt: MqttConfig;
  tls: {
    enabled: boolean;
    keyPath?: string;
    certPath?: string;
  };
  observability: {
    prometheusEnabled: boolean;
    prometheusPath: string;
    decisionLogLevel: 'info' | 'debug';
  };
  controlIntervalSeconds: number;
  staleTelemetryThresholdSeconds: number;
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
      passwordHash: string;
      role: 'viewer' | 'operator' | 'admin';
    }[];
  };
}

function validateSecret(name: string, value: string | undefined, minLength = 24): string {
  if (!value) {
    throw new Error(`[config] ${name} must be injected via environment variable or secret store`);
  }

  if (value.length < minLength) {
    throw new Error(`[config] ${name} must be at least ${minLength} characters long`);
  }

  if (weakPasswords.has(value.toLowerCase())) {
    throw new Error(`[config] ${name} cannot use common or default credentials`);
  }

  return value;
}

function parseUsers(): Config['auth']['users'] {
  const raw = process.env.AUTH_USERS;
  if (!raw) {
    throw new Error(
      '[config] AUTH_USERS is required. Inject a JSON array of users via environment variable or secret manager.',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`[config] AUTH_USERS must be valid JSON: ${(err as Error).message}`);
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('[config] AUTH_USERS must be a non-empty JSON array');
  }

  return parsed.map((u, idx) => {
    if (!u || typeof u !== 'object') {
      throw new Error(`[config] AUTH_USERS[${idx}] must be an object with username/passwordHash/role`);
    }

    const username = (u as { username?: string }).username;
    const password = (u as { password?: string }).password;
    const passwordHash = (u as { passwordHash?: string }).passwordHash;
    const role = (u as { role?: string }).role;

    if (password) {
      throw new Error(
        `[config] AUTH_USERS[${idx}] must provide passwordHash (bcrypt) instead of plaintext password`,
      );
    }

    if (!username || !passwordHash || !role) {
      throw new Error(`[config] AUTH_USERS[${idx}] must include username, passwordHash, and role`);
    }

    if (!['viewer', 'operator', 'admin'].includes(role)) {
      throw new Error(`[config] AUTH_USERS[${idx}].role must be viewer, operator, or admin`);
    }

    if (!isValidPasswordHash(passwordHash)) {
      throw new Error(`[config] AUTH_USERS[${idx}].passwordHash must be a valid bcrypt hash`);
    }

    return {
      username,
      passwordHash,
      role: role as Config['auth']['users'][number]['role'],
    };
  });
}

const config: Config = {
  port: Number(process.env.PORT ?? 3001),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  logPretty: (process.env.LOG_PRETTY ?? 'true').toLowerCase() === 'true',
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
    topicPrefix: (process.env.MQTT_TOPIC_PREFIX ?? 'der').replace(/\/$/, ''),
  },
  tls: {
    enabled: (process.env.TLS_ENABLED ?? 'false').toLowerCase() === 'true',
    keyPath: process.env.TLS_KEY_PATH,
    certPath: process.env.TLS_CERT_PATH,
  },
  observability: {
    prometheusEnabled:
      (process.env.PROMETHEUS_ENABLED ?? 'true').toLowerCase() === 'true',
    prometheusPath: process.env.PROMETHEUS_PATH ?? '/metrics',
    decisionLogLevel: (process.env.DECISION_LOG_LEVEL ?? 'info').toLowerCase() === 'debug'
      ? 'debug'
      : 'info',
  },
  controlIntervalSeconds: Number(process.env.CONTROL_INTERVAL_SECONDS ?? 60),
  staleTelemetryThresholdSeconds: Number(
    process.env.STALE_TELEMETRY_THRESHOLD_SECONDS ?? 300,
  ),
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
    jwtSecret: validateSecret('JWT_SECRET', process.env.JWT_SECRET),
    tokenTtlHours: Number(process.env.JWT_TOKEN_TTL_HOURS ?? 12),
    users: parseUsers(),
  },
};

export default config;
