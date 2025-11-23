import express from 'express';
import cors from 'cors';
import config from './config';
import { initSchema } from './db';
import { startMqttClient } from './mqttClient';
import { startControlLoop } from './controllers/controlLoop';
import feederRouter from './routes/feeder';
import devicesRouter from './routes/devices';
import eventsRouter from './routes/events';

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

    app.get('/api/health', (_req, res) => {
      res.json({ status: 'ok' });
    });

    app.use('/api/feeder', feederRouter);
    app.use('/api', devicesRouter);
    app.use('/api/events', eventsRouter);

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
