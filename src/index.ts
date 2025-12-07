import express from 'express';
import cors from 'cors';
import config from './config';
import { initSchema, pool } from './db';
import { getMqttStatus, startMqttClient } from './mqttClient';
import { startControlLoop } from './controllers/controlLoop';
import feederRouter from './routes/feeder';
import devicesRouter from './routes/devices';
import eventsRouter from './routes/events';
import { openApiSpec } from './openapi';
import simulationRouter from './routes/simulation';
import { getControlLoopState } from './state/controlLoopMonitor';
import drProgramsRouter from './routes/drPrograms';
import metricsRouter from './routes/metrics';

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

async function startServer() {
  try {
    console.log('[startup] initSchema starting');
    await initSchema();
    console.log('[startup] initSchema done');

    try {
      console.log('[startup] starting MQTT client');
      await startMqttClient();
      console.log('[startup] MQTT client started (non-blocking)');
    } catch (err) {
      console.error(
        '[startup] MQTT connect failed, continuing without broker',
        err
      );
    }

    const app = express();
    app.use(cors());
    app.use(express.json());

    app.get('/api/health', async (_req, res) => {
      let dbOk = true;
      try {
        await pool.query('SELECT 1');
      } catch (err) {
        dbOk = false;
        console.error('[health] db check failed', err);
      }

      const controlLoop = getControlLoopState();
      const offlineCount = controlLoop.offlineDevices.length;
      const healthyLoop =
        controlLoop.status !== 'error' && controlLoop.status !== 'stalled';
      const overallStatus =
        dbOk && offlineCount === 0 && healthyLoop ? 'ok' : 'degraded';

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

    app.use('/api/feeder', feederRouter);
    app.use('/api', devicesRouter);
    app.use('/api/events', eventsRouter);
    app.use('/api/simulation', simulationRouter);
    app.use('/api/dr-programs', drProgramsRouter);
    app.use('/api', metricsRouter);

    app.listen(config.port, () => {
      console.log(
        `DERMS feeder controller listening on http://localhost:${config.port}`
      );
    });

    startControlLoop();
  } catch (err) {
    console.error('[startup] failed to start server', err);
    process.exit(1);
  }
}

startServer();
