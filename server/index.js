import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import express from 'express';
import { createApp } from './api.js';
import { openDatabase } from './db.js';

const dataFile = resolve(process.env.DATA_FILE ?? 'data/doomsday.sqlite');
mkdirSync(dirname(dataFile), { recursive: true });
const app = createApp(openDatabase(dataFile));
const server = createServer(app);

if (process.argv.includes('--dev')) {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({ configLoader: 'runner', server: { middlewareMode: true, ws: { server } } });
  app.use(vite.middlewares);
} else {
  app.use(express.static('dist'));
}

const host = process.env.HOST ?? '127.0.0.1';
server.listen(Number(process.env.PORT ?? 3000), host, function () {
  console.log(`Doomsday Ready at http://${host}:${this.address().port}`);
});
