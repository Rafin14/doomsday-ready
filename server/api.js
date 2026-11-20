import express from 'express';
import { bookingQuote, rewatchOrder } from './algorithms.js';
import { transaction } from './db.js';
import { currentReleaseYear, MAX_RUNTIME_MINUTES, MIN_RELEASE_YEAR } from '../shared/movie-rules.js';

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const invalid = message => { throw new ApiError(400, 'VALIDATION_ERROR', message); };
const notFound = label => { throw new ApiError(404, 'NOT_FOUND', `${label} not found.`); };
const integerIn = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

function resourceId(value, label) {
  const id = Number(value);
  if (!/^\d+$/.test(value) || !integerIn(id, 1, Number.MAX_SAFE_INTEGER)) notFound(label);
  return id;
}

function objectBody(body, fields) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Send a JSON object.');
  const keys = Object.keys(body);
  if (!keys.length || keys.some(key => !fields.includes(key))) invalid('Send an object with supported fields.');
  return body;
}

function nameField(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) invalid(`${label} must be non-empty text.`);
  return value.trim();
}

function movieInput(body, existing) {
  const fields = ['title', 'releaseYear', 'runtimeMinutes', 'watched', 'prerequisiteIds'];
  const changes = objectBody(body, fields);
  const data = { watched: false, prerequisiteIds: [], ...existing, ...changes };
  const title = nameField(data.title, 'Title');
  const latestYear = currentReleaseYear();
  // Existing records keep their release year until a request explicitly replaces it.
  if ((!existing || Object.hasOwn(changes, 'releaseYear'))
    && !integerIn(data.releaseYear, MIN_RELEASE_YEAR, latestYear)) {
    invalid(`Release year must be a whole year from ${MIN_RELEASE_YEAR} to ${latestYear}.`);
  }
  if (!integerIn(data.runtimeMinutes, 1, MAX_RUNTIME_MINUTES)) {
    invalid(`Runtime must be a whole number from 1 to ${MAX_RUNTIME_MINUTES} minutes.`);
  }
  if (typeof data.watched !== 'boolean') invalid('Watched must be true or false.');
  const ids = data.prerequisiteIds;
  if (!Array.isArray(ids) || !ids.every(id => integerIn(id, 1, Number.MAX_SAFE_INTEGER))) {
    invalid('Prerequisites must be an array of positive movie IDs.');
  }
  return { ...data, title, prerequisiteIds: [...new Set(ids)].sort((a, b) => a - b) };
}

export function createApp(db) {
  const app = express();
  const api = express.Router();
  const allMovies = db.prepare(`
    SELECT id, title, release_year AS releaseYear, runtime_minutes AS runtimeMinutes, watched,
      (SELECT json_group_array(prerequisite_id ORDER BY prerequisite_id)
       FROM prerequisites WHERE movie_id = movies.id) AS prerequisiteIds
    FROM movies ORDER BY id
  `);
  const insertMovie = db.prepare('INSERT INTO movies (title, release_year, runtime_minutes, watched) VALUES (?, ?, ?, ?)');
  const updateMovie = db.prepare('UPDATE movies SET title = ?, release_year = ?, runtime_minutes = ?, watched = ? WHERE id = ?');
  const deleteLinks = db.prepare('DELETE FROM prerequisites WHERE movie_id = ?');
  const insertLink = db.prepare('INSERT INTO prerequisites VALUES (?, ?)');
  const selectCinemas = db.prepare('SELECT id, name, bundle_sizes FROM cinemas ORDER BY id');
  const selectCinema = db.prepare('SELECT id, name, bundle_sizes FROM cinemas WHERE id = ?');
  const insertCinema = db.prepare('INSERT INTO cinemas (name, bundle_sizes) VALUES (?, ?)');

  function movieSnapshot() {
    const links = new Map();
    const movies = new Map(allMovies.all().map(movie => {
      const prerequisiteIds = JSON.parse(movie.prerequisiteIds);
      links.set(movie.id, prerequisiteIds);
      return [movie.id, { ...movie, watched: Boolean(movie.watched), prerequisiteIds }];
    }));
    return { links, movies };
  }

  function saveMovie(body, id) {
    return transaction(db, () => {
      const { links, movies } = movieSnapshot();
      const existing = movies.get(id);
      if (id !== undefined && !existing) notFound('Movie');
      const { title, releaseYear, runtimeMinutes, watched, prerequisiteIds } = movieInput(body, existing);
      const values = [title, releaseYear, runtimeMinutes, Number(watched)];
      if (existing) updateMovie.run(...values, id);
      else id = insertMovie.run(...values).lastInsertRowid;

      links.set(id, prerequisiteIds);
      if (rewatchOrder(id, links) === null) {
        throw new ApiError(409, 'CIRCULAR_DEPENDENCY', 'A movie cannot depend on itself, directly or through other movies.');
      }
      if (prerequisiteIds.some(dependency => !movies.has(dependency))) invalid('Every prerequisite must be an existing movie.');
      deleteLinks.run(id);
      for (const dependency of prerequisiteIds) insertLink.run(id, dependency);
      return { id, title, releaseYear, runtimeMinutes, watched, prerequisiteIds };
    });
  }

  function cinemaRecord({ id, name, bundle_sizes }) {
    return { id, name, bundleSizes: JSON.parse(bundle_sizes) };
  }

  app.disable('x-powered-by');
  app.use('/api', api);
  api.use(express.json());

  api.get('/movies', (_req, res) => res.json([...movieSnapshot().movies.values()]));
  api.post('/movies', (req, res) => res.status(201).json(saveMovie(req.body)));
  api.patch('/movies/:id', (req, res) => res.json(saveMovie(req.body, resourceId(req.params.id, 'Movie'))));
  api.get('/movies/:id/rewatch-order', (req, res) => {
    const id = resourceId(req.params.id, 'Movie');
    const { movies, links } = movieSnapshot();
    if (!movies.has(id)) notFound('Movie');
    const order = rewatchOrder(id, links).map(movieId => movies.get(movieId));
    const watchedCount = order.filter(movie => movie.watched).length;
    const remainingMinutes = order.reduce((sum, movie) => sum + (movie.watched ? 0 : movie.runtimeMinutes), 0);
    res.json({ order, watchedCount, remainingMinutes });
  });

  api.get('/cinemas', (_req, res) => res.json(selectCinemas.all().map(cinemaRecord)));
  api.post('/cinemas', (req, res) => {
    const body = objectBody(req.body, ['name', 'bundleSizes']);
    const name = nameField(body.name, 'Name');
    const sizes = body.bundleSizes;
    if (!Array.isArray(sizes) || !integerIn(sizes.length, 1, 10)
      || !sizes.every(size => integerIn(size, 1, 500)) || new Set(sizes).size !== sizes.length) {
      invalid('Enter 1 to 10 distinct bundle sizes, each from 1 to 500 seats.');
    }
    const bundleSizes = sizes.toSorted((a, b) => a - b);
    const { lastInsertRowid: id } = insertCinema.run(name, JSON.stringify(bundleSizes));
    res.status(201).json({ id, name, bundleSizes });
  });
  api.get('/cinemas/:id/booking', (req, res) => {
    const cinema = selectCinema.get(resourceId(req.params.id, 'Cinema'));
    if (!cinema) notFound('Cinema');
    const { groupSize } = req.query;
    if (typeof groupSize !== 'string' || !/^\d+$/.test(groupSize) || !integerIn(Number(groupSize), 1, 10_000)) {
      invalid('Group size must be a whole number from 1 to 10,000.');
    }
    res.json(bookingQuote(cinemaRecord(cinema).bundleSizes, Number(groupSize)));
  });

  api.use((_req, _res) => notFound('API route'));
  api.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof ApiError) return res.status(error.status).json({ code: error.code, message: error.message });
    if (error.errcode === 2067) {
      return res.status(409).json({ code: 'DUPLICATE_NAME', message: 'That title or cinema name already exists.' });
    }
    if (error.status === 400 || error.status === 413 || error.status === 415) {
      return res.status(error.status).json({ code: 'INVALID_REQUEST', message: 'Send a valid JSON request within the body size limit.' });
    }
    console.error(error);
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Something went wrong.' });
  });
  return app;
}
