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
};

export default config;
