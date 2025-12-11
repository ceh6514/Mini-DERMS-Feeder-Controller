import config from './config';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function shouldLog(level: LogLevel) {
  const target = levelOrder[config.logLevel as LogLevel] ?? levelOrder.info;
  return levelOrder[level] >= target;
}

function format(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  if (config.logPretty) {
    const timestamp = new Date().toISOString();
    const metaText = meta ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${level}] ${message}${metaText}`;
  }

  return JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    service: 'mini-derms-feeder-controller',
    ...meta,
  });
}

function log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  if (!shouldLog(level)) return;
  const line = format(level, message, meta);
  // eslint-disable-next-line no-console
  console[level === 'debug' ? 'log' : level](line);
}

const logger = {
  debug: (message: string, meta?: Record<string, unknown>) =>
    log('debug', message, meta),
  info: (message: string, meta?: Record<string, unknown>) =>
    log('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) =>
    log('warn', message, meta),
  error: (meta: Record<string, unknown> | Error, message?: string) => {
    if (meta instanceof Error) {
      log('error', message ?? meta.message, { err: meta });
      return;
    }
    log('error', message ?? 'error', meta);
  },
};

export default logger;
