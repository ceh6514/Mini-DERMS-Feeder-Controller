import express from 'express';
import cors from 'cors';
import fs from 'fs';
import http from 'http';
import https from 'https';
import config from './config';
import { initSchema, pool, rebuildPool } from './db';
import { getMqttStatus, startMqttClient, stopMqttClient } from './mqttClient';
import { startControlLoop } from './controllers/controlLoop';
import feederRouter from './routes/feeder';
import devicesRouter from './routes/devices';
import eventsRouter from './routes/events';
import { openApiSpec } from './openapi';
import simulationRouter from './routes/simulation';
import { getControlLoopState } from './state/controlLoopMonitor';
import drProgramsRouter from './routes/drPrograms';
import metricsRouter from './routes/metrics';
import { authRouter, requireAuth } from './auth';
import logger from './logger';
import {
  collectHealthMetrics,
  metricsContentType,
  prometheusPath,
  renderPrometheus,
  shouldExposePrometheus,
} from './observability/metrics';
import { getReadiness, setDbReady } from './state/readiness';

const swaggerHtml = `<!DOCTYPE html>
<html>
  <head>
    <title>Mini DERMS API Docs</title>
    <link
      rel="stylesheet"
      href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css"
    />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.onload = () => {
        SwaggerUIBundle({
          url: '/api/openapi.json',
          dom_id: '#swagger-ui',
          presets: [SwaggerUIBundle.presets.apis],
        });
      };
    </script>
  </body>
</html>`;

export interface StartServerOptions {
  port?: number;
  startControlLoop?: boolean;
  controlLoopIntervalMs?: number;
}

export interface StartedServer {
  app: any;
  server: http.Server | https.Server;
  port: number;
  stop: () => Promise<void>;
}

export async function startServer(
  options: StartServerOptions = {},
): Promise<StartedServer> {
  rebuildPool();
  logger.info('[startup] initSchema starting');
  setDbReady(false, 'initializing');
  await initSchema();
  setDbReady(true);
  logger.info('[startup] initSchema done');

  try {
    logger.info('[startup] starting MQTT client');
    await startMqttClient();
    logger.info('[startup] MQTT client started (non-blocking)');
  } catch (err) {
    logger.error({ err }, '[startup] MQTT connect failed, continuing without broker');
  }

  const app = express();

  const allowedOrigins = new Set(config.ingress.corsAllowedOrigins);
  const corsOptions = {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.has(origin)) return callback(null, true);
      return callback(null, false);
    },
    optionsSuccessStatus: 204,
  };

  app.use(cors(corsOptions));
  app.options('*', cors(corsOptions));
  app.use(express.json({ limit: config.ingress.jsonBodyLimit }));

  app.get('/api/health', async (_req, res) => {
    let dbOk = true;
    try {
      await pool.query('SELECT 1');
    } catch (err) {
      dbOk = false;
      logger.error({ err }, '[health] db check failed');
    }

    const controlLoop = getControlLoopState();
    const offlineCount = controlLoop.offlineDevices.length;
    const readiness = getReadiness();
    const ready = readiness.dbReady && readiness.mqttReady;
    const healthyLoop =
      controlLoop.status !== 'error' &&
      controlLoop.status !== 'stalled' &&
      controlLoop.status !== 'degraded';
    const overallStatus =
      dbOk && ready && offlineCount === 0 && healthyLoop ? 'ok' : 'degraded';

    res.json({
      status: overallStatus,
      db: { ok: dbOk },
      mqtt: getMqttStatus(),
      controlLoop: {
        ...controlLoop,
        offlineCount,
      },
    });
  });

  app.get('/api/openapi.json', (_req, res) => {
    res.json(openApiSpec);
  });

  app.get('/api/docs', (_req, res) => {
    res.type('html').send(swaggerHtml);
  });

  app.use('/api/auth', authRouter);
  app.use('/api', requireAuth);

  app.use('/api/feeder', feederRouter);
  app.use('/api', devicesRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api/simulation', simulationRouter);
  app.use('/api/dr-programs', drProgramsRouter);
  app.use('/api', metricsRouter);

  if (shouldExposePrometheus()) {
    app.get(prometheusPath(), async (_req, res) => {
      await collectHealthMetrics();
      res.setHeader('Content-Type', metricsContentType());
      res.send(renderPrometheus());
    });
  }

  let server: http.Server | https.Server;
  const desiredPort = options.port ?? config.port;
  if (config.tls.enabled) {
    if (!config.tls.keyPath || !config.tls.certPath) {
      logger.warn(
        '[startup] TLS enabled but TLS_KEY_PATH/TLS_CERT_PATH are missing; falling back to HTTP',
      );
      server = http.createServer(app);
    } else {
      server = https.createServer(
        {
          key: fs.readFileSync(config.tls.keyPath),
          cert: fs.readFileSync(config.tls.certPath),
        },
        app,
      );
    }
  } else {
    server = http.createServer(app);
  }

  const actualPort = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(desiredPort, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : desiredPort;
      const protocol = config.tls.enabled ? 'https' : 'http';
      logger.info(`DERMS feeder controller listening on ${protocol}://localhost:${port}`);
      resolve(port);
    });
  });

  const controlLoopHandle = options.startControlLoop === false
    ? null
    : startControlLoop({ intervalMs: options.controlLoopIntervalMs });

  const stop = async () => {
    controlLoopHandle?.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await stopMqttClient();
    await pool.end();
  };

  return { app, server, port: actualPort, stop };
}
