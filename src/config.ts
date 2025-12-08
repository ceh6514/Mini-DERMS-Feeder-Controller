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
  };
  trackingErrorWindowMinutes: number;
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
  },
  trackingErrorWindowMinutes: Number(process.env.TRACKING_ERROR_WINDOW_MINUTES ?? 10),
};

export default config;
