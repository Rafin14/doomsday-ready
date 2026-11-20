import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createApp } from '../server/api.js';
import { openDatabase } from '../server/db.js';
import { rewatchOrder } from '../server/algorithms.js';

let server;
let db;
let base;

before(async () => {
  db = openDatabase(':memory:');
  server = createApp(db).listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  db.close();
});

async function request(path, status = 200, method = 'GET', body) {
  const response = await fetch(base + path, {
    method,
    ...(body && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  assert.equal(response.status, status, JSON.stringify(data));
  return data;
}

test('all seeded watch orders respect prerequisites and report the unwatched runtime', async () => {
  const movies = await request('/movies');
  const plan = await request('/movies/8/rewatch-order');
  const ids = plan.order.map(movie => movie.id);
  assert.deepEqual(ids.toSorted((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7]);
  for (const movie of plan.order) {
    for (const dependency of movie.prerequisiteIds) assert.ok(ids.indexOf(dependency) < ids.indexOf(movie.id));
  }
  assert.equal(plan.watchedCount, 0);
  assert.equal(plan.remainingMinutes, movies.slice(0, 7).reduce((sum, movie) => sum + movie.runtimeMinutes, 0));
  assert.deepEqual((await request('/movies/4/rewatch-order')).order.map(movie => movie.id), [1, 2, 3]);
  assert.deepEqual(await request('/movies/5/rewatch-order'), { order: [], watchedCount: 0, remainingMinutes: 0 });
  await request('/movies/1', 200, 'PATCH', { watched: true });
  const updated = await request('/movies/8/rewatch-order');
  assert.equal(updated.watchedCount, 1);
  assert.equal(updated.remainingMinutes, plan.remainingMinutes - movies[0].runtimeMinutes);
});

test('create and edit prerequisites, deduplicate shared ancestors, and roll back cycles', async () => {
  const fields = { title: 'New release', releaseYear: 2027, runtimeMinutes: 100 };
  const directCreate = await request('/movies', 409, 'POST', { ...fields, prerequisiteIds: [9] });
  assert.equal(directCreate.code, 'CIRCULAR_DEPENDENCY');
  const created = await request('/movies', 201, 'POST', { ...fields, prerequisiteIds: [4, 3, 4] });
  assert.equal(created.watched, false);
  assert.deepEqual(created.prerequisiteIds, [3, 4]);
  assert.deepEqual((await request(`/movies/${created.id}/rewatch-order`)).order.map(movie => movie.id), [1, 2, 3, 4]);
  const beforeCycle = (await request('/movies')).find(movie => movie.id === 1);
  assert.equal((await request('/movies/1', 409, 'PATCH', { watched: !beforeCycle.watched, prerequisiteIds: [7] })).code, 'CIRCULAR_DEPENDENCY');
  assert.equal((await request('/movies/1', 409, 'PATCH', { prerequisiteIds: [1] })).code, 'CIRCULAR_DEPENDENCY');
  const ironMan = (await request('/movies')).find(movie => movie.id === 1);
  assert.deepEqual(ironMan, beforeCycle);
  assert.deepEqual((await request(`/movies/${created.id}`, 200, 'PATCH', { prerequisiteIds: [] })).prerequisiteIds, []);
});

test('invalid and duplicate records return JSON errors', async () => {
  const fields = { title: 'Validation test', releaseYear: 2027, runtimeMinutes: 90 };
  for (const body of [{ runtimeMinutes: 301 }, { runtimeMinutes: 0 }, { watched: 'true' }, { prerequisiteIds: [999] }, { releaseYear: 2.5 }]) {
    assert.equal((await request('/movies', 400, 'POST', { ...fields, ...body })).code, 'VALIDATION_ERROR');
  }
  assert.equal((await request('/movies', 409, 'POST', { ...fields, title: ' iron man ' })).code, 'DUPLICATE_NAME');
  await request('/movies/1e0/rewatch-order', 404);
  await request('/movies/999', 404, 'PATCH', { watched: true });
  await request('/cinemas/999/booking?groupSize=1', 404);
  for (const size of ['', '0', '1.5', '10001', '6&groupSize=7']) {
    await request(`/cinemas/1/booking?groupSize=${size}`, 400);
  }
  for (const bundleSizes of [[], [2, 2], [0], [501], Array.from({ length: 11 }, (_, i) => i + 1)]) {
    await request('/cinemas', 400, 'POST', { name: 'Invalid', bundleSizes });
  }
  await request('/cinemas', 409, 'POST', { name: 'starlight cinema', bundleSizes: [1] });
});

test('all four example quotes and the maximum group size', async () => {
  const examples = [
    [1, 6, 2, [{ size: 3, quantity: 2 }]],
    [2, 11, 4, [{ size: 5, quantity: 1 }, { size: 2, quantity: 3 }]],
    [3, 44, 4, [{ size: 20, quantity: 1 }, { size: 9, quantity: 2 }, { size: 6, quantity: 1 }]],
  ];
  for (const [cinema, groupSize, bundleCount, bundles] of examples) {
    assert.deepEqual(await request(`/cinemas/${cinema}/booking?groupSize=${groupSize}`),
      { possible: true, groupSize, bundleCount, bundles });
  }
  assert.deepEqual(await request('/cinemas/4/booking?groupSize=7'), { possible: false, groupSize: 7 });
  const cinema = await request('/cinemas', 201, 'POST', { name: 'Maximum', bundleSizes: [500, 1] });
  assert.deepEqual(cinema.bundleSizes, [1, 500]);
  assert.deepEqual((await request('/cinemas')).at(-1), cinema);
  assert.deepEqual(await request(`/cinemas/${cinema.id}/booking?groupSize=10000`), {
    possible: true, groupSize: 10000, bundleCount: 20, bundles: [{ size: 500, quantity: 20 }],
  });
});

test('a long prerequisite chain does not exhaust the JavaScript call stack', () => {
  const chain = new Map(Array.from({ length: 15_000 }, (_, i) => [i, [i + 1]]));
  const result = rewatchOrder(0, chain);
  assert.equal(result.length, 15_000);
  assert.equal(result[0], 15_000);
  assert.equal(result.at(-1), 1);
  chain.set(15_000, [0]);
  assert.equal(rewatchOrder(0, chain), null);
});

test('database reopens with changes and seeds only once', () => {
  const directory = mkdtempSync(join(tmpdir(), 'doomsday-'));
  const file = join(directory, 'test.sqlite');
  try {
    const first = openDatabase(file);
    try {
      first.prepare('UPDATE movies SET watched = 1 WHERE id = 1').run();
    } finally {
      first.close();
    }
    const reopened = openDatabase(file);
    try {
      assert.equal(reopened.prepare('SELECT watched FROM movies WHERE id = 1').get().watched, 1);
      assert.equal(reopened.prepare('SELECT count(*) AS count FROM movies').get().count, 8);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(file, { force: true });
    rmdirSync(directory);
  }
});
