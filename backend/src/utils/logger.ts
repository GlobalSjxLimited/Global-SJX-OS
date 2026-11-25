import pino from 'pino';
import { env } from '../config/env';

/**
 * Structured JSON logging in production (so it's parseable by any log
 * aggregator), pretty-printed in development for readability. Replaces the
 * scattered console.log/console.error calls that were previously all over
 * the codebase.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || (env.nodeEnv === 'production' ? 'info' : 'debug'),
  transport:
    env.nodeEnv === 'production'
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
});
