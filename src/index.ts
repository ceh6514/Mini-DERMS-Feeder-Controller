import express from 'express';
import cors from 'cors';
import config from './config.js';
import { initSchema } from './db.js';
import { startMqttClient } from './mqttClient.js';
import { startControlLoop } from './controllers/controlLoop.js';
import feederRouter from './routes/feeder.js';
import devicesRouter from './routes/devices.js';
import eventsRouter from './routes/events.js';

async function startServer() {
  try {
    await initSchema();
    await startMqttClient();

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
      console.log(`DERMS feeder controller listening on port ${config.port}`);
    });

    startControlLoop();
  } catch (err) {
    console.error('[startup] failed to start server', err);
    process.exit(1);
  }
}

startServer();
