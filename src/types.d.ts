declare module 'pg';

declare module 'express-serve-static-core' {
  export interface Request {
    rawBody?: Buffer;
  }
}

declare module 'mqtt/dist/mqtt';
