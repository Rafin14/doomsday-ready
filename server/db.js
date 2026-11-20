import { DatabaseSync } from 'node:sqlite';

const sampleMovies = [
  ['Iron Man', 2008, 126, []],
  ['Captain America: The First Avenger', 2011, 124, []],
  ['The Avengers', 2012, 143, [1, 2]],
  ['Captain America: Civil War', 2016, 147, [3]],
  ['Thor: Ragnarok', 2017, 130, []],
  ['Avengers: Infinity War', 2018, 149, [4, 5]],
  ['Avengers: Endgame', 2019, 181, [6]],
  ['Avengers: Doomsday', 2026, 150, [7]],
];

export function transaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function openDatabase(file, { seed = true } = {}) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');

  transaction(db, () => {
    if (db.prepare('PRAGMA user_version').get().user_version !== 0) return;
    db.exec(`
      CREATE TABLE movies (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL COLLATE NOCASE UNIQUE,
        release_year INTEGER NOT NULL CHECK (release_year BETWEEN 1 AND 9999),
        runtime_minutes INTEGER NOT NULL CHECK (runtime_minutes BETWEEN 1 AND 300),
        watched INTEGER NOT NULL DEFAULT 0 CHECK (watched IN (0, 1))
      ) STRICT;
      CREATE TABLE prerequisites (
        movie_id INTEGER NOT NULL REFERENCES movies(id),
        prerequisite_id INTEGER NOT NULL REFERENCES movies(id),
        PRIMARY KEY (movie_id, prerequisite_id)
      ) STRICT;
      CREATE TABLE cinemas (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        bundle_sizes TEXT NOT NULL
      ) STRICT;
      PRAGMA user_version = 1;
    `);
    if (!seed) return;
    const movie = db.prepare('INSERT INTO movies (title, release_year, runtime_minutes) VALUES (?, ?, ?)');
    const link = db.prepare('INSERT INTO prerequisites VALUES (?, ?)');
    for (const [title, year, runtime, dependencies] of sampleMovies) {
      const { lastInsertRowid } = movie.run(title, year, runtime);
      for (const dependency of dependencies) link.run(lastInsertRowid, dependency);
    }
    const cinema = db.prepare('INSERT INTO cinemas (name, bundle_sizes) VALUES (?, ?)');
    cinema.run('Starlight Cinema', '[1,3,4]');
    cinema.run('The Grand Picturehouse', '[2,5]');
    cinema.run('Orbit Multiplex', '[6,9,20]');
    cinema.run('Rex Theatre', '[4,6]');
  });
  return db;
}
