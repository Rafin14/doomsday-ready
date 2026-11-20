import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import ErrorNotice from '../ErrorNotice.jsx';

const duration = minutes => minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;

export default function Rewatch({ movies }) {
  const defaultMovie = movies.find(movie => movie.title === 'Avengers: Doomsday') ?? movies.at(-1);
  const [target, setTarget] = useState(String(defaultMovie?.id ?? ''));
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!target) return;
    let current = true;
    api(`/movies/${target}/rewatch-order`).then(
      data => { if (current) setResult({ target, data }); },
      error => { if (current) setResult({ target, error: error.message }); },
    );
    return () => { current = false; };
  }, [target, movies]);

  const plan = result?.target === target ? result.data : null;
  return (
    <div className="workspace rewatch-workspace">
      <section className="panel editor" aria-labelledby="plan">
        <div className="panel-header"><h2 id="plan">Your plan</h2></div>
        <label>Target movie
          <select value={target} disabled={!movies.length} onChange={event => {
            setResult(null);
            setTarget(event.target.value);
          }}>
            {!movies.length && <option value="">No movies yet</option>}
            {movies.map(movie => <option key={movie.id} value={movie.id}>{movie.title}</option>)}
          </select>
        </label>
        {plan && <div className="summary" aria-live="polite">
          <div className="plan-duration">
            <p className="meta">Remaining watch time</p>
            <span className="metric">{duration(plan.remainingMinutes)}</span>
          </div>
          <label htmlFor="progress">{plan.watchedCount} of {plan.order.length} watched</label>
          <progress id="progress" value={plan.order.length ? plan.watchedCount : 1} max={plan.order.length || 1} />
        </div>}
      </section>
      <section className="panel watch-order" aria-labelledby="watch-order">
        <div className="panel-header"><h2 id="watch-order">Watch order</h2>{plan && <span className="meta count">{plan.order.length} {plan.order.length === 1 ? 'film' : 'films'}</span>}</div>
        {result?.target === target && <ErrorNotice message={result.error} />}
        {!target && <p className="muted">Add a movie to make a rewatch plan.</p>}
        {target && result?.target !== target && <p role="status">Loading watch order…</p>}
        {plan && (plan.order.length ? <ol className="film-list order-list">
          {plan.order.map(movie => <li key={movie.id} className="film-row">
            <div>
              <h3>{movie.title}</h3>
              <p className="meta">{movie.releaseYear} · {movie.runtimeMinutes} min</p>
            </div>
            <span className={movie.watched ? 'watched' : 'meta'}>{movie.watched ? '✓ Watched' : 'Unwatched'}</span>
          </li>)}
        </ol> : <p className="muted">This movie has no prerequisites.</p>)}
      </section>
    </div>
  );
}
