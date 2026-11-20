import React, { useEffect, useRef, useState } from 'react';
import { currentReleaseYear, MAX_RUNTIME_MINUTES, MIN_RELEASE_YEAR } from '../../shared/movie-rules.js';
import ErrorNotice from '../ErrorNotice.jsx';

function MovieEditor({ movie, movies, onSave, onCancel, focusTitle = false }) {
  const [selected, setSelected] = useState(movie?.prerequisiteIds ?? []);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const options = movies.filter(option => option.id !== movie?.id);
  const latestYear = currentReleaseYear();

  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = movie ? { prerequisiteIds: selected } : {
      title: form.get('title'),
      releaseYear: Number(form.get('releaseYear')),
      runtimeMinutes: Number(form.get('runtimeMinutes')),
      prerequisiteIds: selected,
    };
    setPending(true);
    setError('');
    try {
      await onSave(body);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <fieldset disabled={pending} className="fields">
        {!movie && <>
          <label>Title<input name="title" required autoFocus={focusTitle} /></label>
          <div className="form-row">
            <label>Release year<input name="releaseYear" type="number" min={MIN_RELEASE_YEAR} max={latestYear} required /></label>
            <label>Runtime (min)<input name="runtimeMinutes" type="number" min="1" max={MAX_RUNTIME_MINUTES} required /></label>
          </div>
        </>}
        <fieldset className="check-field">
          <legend>Prerequisites</legend>
          {options.length ? <div className="options">
            {options.map(option => (
              <label className="check" key={option.id}>
                <input type="checkbox" checked={selected.includes(option.id)} onChange={event => {
                  const checked = event.target.checked;
                  setSelected(current => checked ? [...current, option.id] : current.filter(id => id !== option.id));
                }} />
                {option.title}
              </label>
            ))}
          </div> : <p className="muted">No other movies available.</p>}
        </fieldset>
        <ErrorNotice message={error} />
        <div className="actions">
          <button className="primary">{pending ? 'Saving…' : movie ? 'Save prerequisites' : 'Add movie'}</button>
          {movie && <button type="button" onClick={onCancel}>Cancel</button>}
        </div>
      </fieldset>
    </form>
  );
}

export default function Movies({ movies, saveMovie, savingMovieIds }) {
  const [editing, setEditing] = useState(null);
  const [editorVersion, setEditorVersion] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const returnFocusTo = useRef(null);
  const watchedCount = movies.filter(movie => movie.watched).length;

  useEffect(() => {
    const id = returnFocusTo.current;
    if (id !== null && editing === null && !savingMovieIds.includes(id)) {
      returnFocusTo.current = null;
      document.getElementById(`edit-movie-${id}`)?.focus();
    }
  }, [editing, savingMovieIds]);

  function closeEditor(id) {
    const editor = document.getElementById(`movie-editor-${id}`);
    if (editor && (editor.contains(document.activeElement) || document.activeElement === document.body)) {
      returnFocusTo.current = id;
    }
    setEditing(current => current === id ? null : current);
  }

  async function toggle(movie, watched) {
    setError('');
    try {
      await saveMovie(movie.id, { watched });
    } catch (failure) {
      setError(failure.message);
    }
  }

  return (
    <div className="workspace">
      <section className="panel" aria-labelledby="library">
        <div className="panel-header">
          <h2 id="library">Movie library</h2>
          <span className="meta count">{watchedCount} of {movies.length} watched</span>
        </div>
        <ErrorNotice message={error} />
        {movies.length ? <ul className="film-list">
          {movies.map(movie => (
            <li key={movie.id}>
              <div className="film-row">
                <div>
                  <h3>{movie.title}</h3>
                  <p className="meta">{movie.releaseYear} <span aria-hidden="true">·</span> {movie.runtimeMinutes} min <span aria-hidden="true">·</span> {movie.prerequisiteIds.length} {movie.prerequisiteIds.length === 1 ? 'prerequisite' : 'prerequisites'}</p>
                </div>
                <div className="row-actions">
                  <label className="check watch-toggle">
                    <input type="checkbox" checked={movie.watched} disabled={savingMovieIds.includes(movie.id) || editing === movie.id}
                      aria-label={`Watched: ${movie.title}`} onChange={event => toggle(movie, event.target.checked)} />
                    Watched
                  </label>
                  <button type="button" id={`edit-movie-${movie.id}`} aria-label={`Edit prerequisites for ${movie.title}`}
                    aria-expanded={editing === movie.id} disabled={savingMovieIds.includes(movie.id)}
                    onClick={() => setEditing(editing === movie.id ? null : movie.id)}>Edit</button>
                </div>
              </div>
              {editing === movie.id && <div className="inline-editor" id={`movie-editor-${movie.id}`}>
                <MovieEditor movie={movie} movies={movies} onCancel={() => closeEditor(movie.id)} onSave={async body => {
                  await saveMovie(movie.id, body);
                  closeEditor(movie.id);
                  setNotice(`Prerequisites saved for ${movie.title}.`);
                }} />
              </div>}
            </li>
          ))}
        </ul> : <p className="muted">Your library is empty. Add a movie to get started.</p>}
      </section>
      <section className="panel editor" aria-labelledby="add-movie">
        <div className="panel-header"><h2 id="add-movie">Add a movie</h2></div>
        <MovieEditor key={editorVersion} movies={movies} focusTitle={editorVersion > 0} onSave={async body => {
          const movie = await saveMovie(null, body);
          setEditorVersion(version => version + 1);
          setNotice(`Added ${movie.title}.`);
        }} />
        <p className="status" role="status">{notice}</p>
      </section>
    </div>
  );
}
