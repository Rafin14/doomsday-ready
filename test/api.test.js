import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { createApp } from '../server/api.js';
import { openDatabase } from '../server/db.js';
import { rewatchOrder } from '../server/algorithms.js';

let api;
let db;

async function startApi(database) {
  const server = createApp(database).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
  return {
    fetch: (path, options) => fetch(baseUrl + path, options),
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

beforeEach(async () => {
  db = openDatabase(':memory:');
  api = await startApi(db);
});

afterEach(async () => {
  await api.close();
  db.close();
});

async function request(path, status = 200, method = 'GET', body, client = api) {
  const response = await client.fetch(path, {
    method,
    ...(body !== undefined && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
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
  const fields = { title: 'New release', releaseYear: 2020, runtimeMinutes: 100 };
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
  const fields = { title: 'Validation test', releaseYear: 2020, runtimeMinutes: 90 };
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

test('release-year and runtime boundaries apply on create and explicit updates', async () => {
  const latestYear = new Date().getUTCFullYear();
  const fields = { title: 'Year boundaries', releaseYear: latestYear, runtimeMinutes: 300 };
  for (const releaseYear of [1887, latestYear + 1, latestYear + .5, String(latestYear), null]) {
    const error = await request('/movies', 400, 'POST', { ...fields, releaseYear });
    assert.equal(error.code, 'VALIDATION_ERROR');
    assert.match(error.message, /Release year/);
  }
  const movie = await request('/movies', 201, 'POST', fields);
  assert.equal(movie.releaseYear, latestYear);
  assert.equal(movie.runtimeMinutes, 300);
  const path = `/movies/${movie.id}`;
  const rejected = await request(path, 400, 'PATCH', { releaseYear: latestYear + 1, watched: true });
  assert.match(rejected.message, /Release year/);
  assert.deepEqual((await request('/movies')).find(item => item.id === movie.id), movie);
  const updated = await request(path, 200, 'PATCH', { releaseYear: 1888, runtimeMinutes: 1 });
  assert.equal(updated.releaseYear, 1888);
  assert.equal(updated.runtimeMinutes, 1);
});

test('pre-existing out-of-range years can be read, edited and corrected', async () => {
  const releaseYear = new Date().getUTCFullYear() + 1;
  const { lastInsertRowid: id } = db.prepare(
    'INSERT INTO movies (title, release_year, runtime_minutes) VALUES (?, ?, ?)',
  ).run('Legacy release', releaseYear, 90);
  assert.equal((await request('/movies')).find(movie => movie.id === id).releaseYear, releaseYear);
  const path = `/movies/${id}`;
  const updated = await request(path, 200, 'PATCH', { watched: true, prerequisiteIds: [1] });
  assert.equal(updated.releaseYear, releaseYear);
  assert.equal(updated.watched, true);
  assert.deepEqual(updated.prerequisiteIds, [1]);
  assert.equal((await request(path, 200, 'PATCH', { releaseYear: 2020 })).releaseYear, 2020);
});

test('malformed requests return JSON errors without mutating records', async () => {
  for (const [body, type, status] of [
    ['{', 'application/json', 400],
    ['null', 'application/json', 400],
    ['{}', 'application/json; charset=latin1', 415],
    [JSON.stringify({ title: 'x'.repeat(110_000) }), 'application/json', 413],
  ]) {
    const response = await api.fetch('/movies', { method: 'POST', headers: { 'Content-Type': type }, body });
    assert.equal(response.status, status);
    assert.equal((await response.json()).code, 'INVALID_REQUEST');
  }
  for (const body of [[], {}, { unexpected: true }]) {
    assert.equal((await request('/movies', 400, 'POST', body)).code, 'VALIDATION_ERROR');
  }
  assert.equal((await request('/unknown', 404)).code, 'NOT_FOUND');
  assert.equal((await request('/movies')).length, 8);
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
  assert.deepEqual(await request('/cinemas/1/booking?groupSize=1'), {
    possible: true, groupSize: 1, bundleCount: 1, bundles: [{ size: 1, quantity: 1 }],
  });
  const tie = await request('/cinemas', 201, 'POST', { name: 'Tie quote', bundleSizes: [1, 2, 3] });
  assert.deepEqual(await request(`/cinemas/${tie.id}/booking?groupSize=4`), {
    possible: true, groupSize: 4, bundleCount: 2, bundles: [{ size: 3, quantity: 1 }, { size: 1, quantity: 1 }],
  });
  const tenSizes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 500];
  assert.deepEqual((await request('/cinemas', 201, 'POST', { name: 'Ten bundles', bundleSizes: tenSizes })).bundleSizes, tenSizes);
  const cinema = await request('/cinemas', 201, 'POST', { name: 'Maximum', bundleSizes: [500, 1] });
  assert.deepEqual(cinema.bundleSizes, [1, 500]);
  assert.deepEqual((await request('/cinemas')).at(-1), cinema);
  assert.deepEqual(await request(`/cinemas/${cinema.id}/booking?groupSize=10000`), {
    possible: true, groupSize: 10000, bundleCount: 20, bundles: [{ size: 500, quantity: 20 }],
  });
});

test('duplicate movie and cinema names stay unique during simultaneous requests', async () => {
  for (const [path, body] of [
    ['/movies', { title: 'Concurrent movie', releaseYear: 2020, runtimeMinutes: 90 }],
    ['/cinemas', { name: 'Concurrent cinema', bundleSizes: [1] }],
  ]) {
    const responses = await Promise.all(Array.from({ length: 2 }, () => api.fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })));
    assert.deepEqual(responses.map(response => response.status).toSorted(), [201, 409]);
    const conflict = responses.find(response => response.status === 409);
    assert.equal((await conflict.json()).code, 'DUPLICATE_NAME');
  }
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

test('database reopens with movies, links and cinemas and seeds only once', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'doomsday-'));
  const file = join(directory, 'test.sqlite');
  try {
    const firstDatabase = openDatabase(file);
    const first = await startApi(firstDatabase);
    let movieId;
    let cinemaId;
    try {
      const movie = await request('/movies', 201, 'POST', {
        title: 'Saved release', releaseYear: 2020, runtimeMinutes: 88,
      }, first);
      movieId = movie.id;
      await request(`/movies/${movieId}`, 200, 'PATCH', { watched: true, prerequisiteIds: [3] }, first);
      cinemaId = (await request('/cinemas', 201, 'POST', { name: 'Saved cinema', bundleSizes: [7] }, first)).id;
    } finally {
      await first.close();
      firstDatabase.close();
    }
    const reopened = openDatabase(file);
    const second = await startApi(reopened);
    try {
      const movies = await request('/movies', 200, 'GET', undefined, second);
      assert.equal(movies.length, 9);
      const movie = movies.find(item => item.id === movieId);
      assert.equal(movie.watched, true);
      assert.deepEqual(movie.prerequisiteIds, [3]);
      const plan = await request(`/movies/${movieId}/rewatch-order`, 200, 'GET', undefined, second);
      assert.deepEqual(plan.order.map(item => item.id), [1, 2, 3]);
      const cinemas = await request('/cinemas', 200, 'GET', undefined, second);
      assert.equal(cinemas.length, 5);
      assert.deepEqual(cinemas.find(cinema => cinema.id === cinemaId).bundleSizes, [7]);
    } finally {
      await second.close();
      reopened.close();
    }
  } finally {
    rmSync(file, { force: true });
    rmdirSync(directory);
  }
});
