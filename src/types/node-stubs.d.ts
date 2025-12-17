declare var process: {
  env: Record<string, string | undefined>;
  exit(code?: number): void;
  nextTick?: (...args: any[]) => void;
};

declare type Buffer = any;
declare var Buffer: {
  from(input: any, encoding?: string): any;
  isBuffer(obj: any): boolean;
  alloc?(size: number): any;
  byteLength?(input: any): number;
};

declare var require: any;
declare var module: any;
declare const __dirname: string;
declare function setTimeout(handler: any, timeout?: number, ...args: any[]): any;
declare function clearTimeout(id: any): void;
declare function setImmediate(handler: any, ...args: any[]): any;
declare function clearImmediate(id: any): void;

declare module 'crypto' {
  export function randomBytes(size: number): any;
  export function randomUUID(): string;
  export function createHmac(...args: any[]): any;
  export function timingSafeEqual(a: any, b: any): boolean;
  export function scrypt(password: any, salt: any, keylen: number, options: any, cb: any): any;
  const crypto: any;
  export = crypto;
}

declare module 'node:crypto' {
  export * from 'crypto';
}

declare module 'fs' {
  const fs: any;
  export = fs;
}

declare module 'node:fs' {
  export * from 'fs';
}

declare module 'path' {
  const path: any;
  export = path;
}

declare module 'node:path' {
  export * from 'path';
}

declare module 'http' {
  export type IncomingMessage = any;
  export type ServerResponse = any;
  export interface Server {
    listen: (...args: any[]) => any;
    close: (...args: any[]) => any;
    address?: (...args: any[]) => any;
    once?: (...args: any[]) => any;
  }
  const createServer: (...args: any[]) => Server;
  export function request(...args: any[]): any;
  export { createServer };
}

declare module 'node:http' {
  export * from 'http';
}

declare module 'https' {
  export interface RequestOptions { [key: string]: any }
  export interface Server {
    listen?: (...args: any[]) => any;
    close?: (...args: any[]) => any;
    address?: (...args: any[]) => any;
    once?: (...args: any[]) => any;
  }
  const https: any;
  export function request(...args: any[]): any;
  export = https;
}

declare module 'node:https' {
  export * from 'https';
}

declare module 'url' {
  const url: any;
  export = url;
}

declare module 'node:url' {
  export * from 'url';
}

declare module 'events' {
  export class EventEmitter {
    on: (...args: any[]) => this;
    off?: (...args: any[]) => this;
    emit: (...args: any[]) => boolean;
  }
}

declare module 'node:events' {
  export * from 'events';
}

declare module 'stream' {
  export class Readable {
    pipe?: (...args: any[]) => any;
  }
  export class Writable {}
  export class Duplex {}
  export class Transform {}
  export class PassThrough {}
}

declare module 'node:stream' {
  export * from 'stream';
}

declare module 'buffer' {
  export const Buffer: any;
  export default Buffer;
}

declare module 'node:buffer' {
  export * from 'buffer';
}

declare module 'assert' {
  const assert: any;
  export = assert;
}

declare module 'node:assert/strict' {
  const assert: any;
  export = assert;
}

declare module 'node:test' {
  export const describe: any;
  export const it: any;
  export const test: any;
  export const beforeEach: any;
  export const afterEach: any;
  export const mock: any;
}

declare module 'timers' {
  const timers: any;
  export = timers;
}

declare module 'node:timers' {
  export * from 'timers';
}

declare module 'util' {
  const util: any;
  export = util;
}

declare module 'node:util' {
  export * from 'util';
}

declare module 'net' {
  const net: any;
  export = net;
}

declare module 'tls' {
  const tls: any;
  export = tls;
}

declare module 'zlib' {
  const zlib: any;
  export = zlib;
}

declare module 'dns' {
  const dns: any;
  export = dns;
}

declare module 'os' {
  const os: any;
  export = os;
}

declare module 'node:buffer' {
  export * from 'buffer';
}

declare module 'node:child_process' {
  export const spawnSync: any;
}

declare module 'express' {
  export as namespace express;
  export interface Express extends Application {}
  export type Request = any;
  export type Response = any;
  export type NextFunction = any;
  export type Router = any;
  export interface Application {
    use: (...args: any[]) => any;
    listen: (...args: any[]) => any;
  }
  const e: any;
  export function Router(): Router;
  export function json(): any;
  export default e;
  export namespace express {
    type Express = Application;
  }
}

declare module 'express-serve-static-core' {
  export type Request = any;
  export type Response = any;
  export type NextFunction = any;
}

declare module 'cors' {
  const cors: any;
  export = cors;
}

declare module 'dotenv' {
  export function config(options?: any): any;
}

declare module 'pg' {
  export class Client {
    constructor(config?: any);
    connect: (...args: any[]) => any;
    query: (...args: any[]) => any;
    end: (...args: any[]) => any;
  }
}

declare module 'mqtt' {
  const mqtt: any;
  export = mqtt;
}

declare module 'javascript-lp-solver' {
  const solver: any;
  export = solver;
}

declare module 'ws' {
  const ws: any;
  export = ws;
}
