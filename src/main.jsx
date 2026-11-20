import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

async function api(path, method = 'GET', body) {
  const response = await fetch(`/api${path}`, {
    method,
    ...(body && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message);
  return data;
}

const views = [
  { id: 'movies', label: 'Movies' },
  { id: 'rewatch', label: 'Rewatch Plan' },
  { id: 'booking', label: 'Booking' },
];
const activeView = () => views.find(view => view.id === location.hash.slice(1))?.id ?? 'movies';
const duration = minutes => minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;

function ErrorNotice({ message }) {
  return message && <p className="error" role="alert">{message}</p>;
}

function MovieEditor({ movie, movies, onSave, onCancel }) {
  const [selected, setSelected] = useState(movie?.prerequisiteIds ?? []);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const options = movies.filter(option => option.id !== movie?.id);

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
          <label>Title<input name="title" required /></label>
          <div className="form-row">
            <label>Release year<input name="releaseYear" type="number" min="1" max="9999" required /></label>
            <label>Runtime (min)<input name="runtimeMinutes" type="number" min="1" max="300" required /></label>
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

function Movies({ movies, onMovie }) {
  const [editing, setEditing] = useState(null);
  const [editorVersion, setEditorVersion] = useState(0);
  const [busy, setBusy] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function save(id, body) {
    const movie = await api(id ? `/movies/${id}` : '/movies', id ? 'PATCH' : 'POST', body);
    onMovie(movie);
    return movie;
  }

  async function toggle(movie, watched) {
    setError('');
    setBusy(current => [...current, movie.id]);
    try {
      await save(movie.id, { watched });
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(current => current.filter(id => id !== movie.id));
    }
  }

  return (
    <div className="workspace">
      <section className="panel" aria-labelledby="library">
        <div className="panel-header"><h2 id="library">Movie library</h2><span className="meta">{movies.length} films</span></div>
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
                  <label className="check">
                    <input type="checkbox" checked={movie.watched} disabled={busy.includes(movie.id) || editing === movie.id}
                      aria-label={`Watched: ${movie.title}`} onChange={event => toggle(movie, event.target.checked)} />
                    Watched
                  </label>
                  <button type="button" aria-label={`Edit prerequisites for ${movie.title}`} aria-expanded={editing === movie.id}
                    disabled={busy.includes(movie.id)}
                    onClick={() => setEditing(editing === movie.id ? null : movie.id)}>Edit</button>
                </div>
              </div>
              {editing === movie.id && <div className="inline-editor">
                <MovieEditor movie={movie} movies={movies} onCancel={() => setEditing(null)} onSave={async body => {
                  await save(movie.id, body);
                  setEditing(current => current === movie.id ? null : current);
                  setNotice(`Prerequisites saved for ${movie.title}.`);
                }} />
              </div>}
            </li>
          ))}
        </ul> : <p className="muted">Your library is empty. Add a movie to get started.</p>}
      </section>
      <section className="panel editor" aria-labelledby="add-movie">
        <div className="panel-header"><h2 id="add-movie">Add a movie</h2></div>
        <MovieEditor key={editorVersion} movies={movies} onSave={async body => {
          const movie = await save(null, body);
          setEditorVersion(version => version + 1);
          setNotice(`Added ${movie.title}.`);
        }} />
        <p className="status" role="status">{notice}</p>
      </section>
    </div>
  );
}

function Rewatch({ movies }) {
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
    <div className="workspace">
      <section className="panel" aria-labelledby="watch-order">
        <div className="panel-header"><h2 id="watch-order">Watch order</h2>{plan && <span className="meta">{plan.order.length} films</span>}</div>
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
      <section className="panel editor" aria-labelledby="plan">
        <div className="panel-header"><h2 id="plan">Your plan</h2></div>
        <label>Target movie
          <select value={target} disabled={!movies.length} onChange={event => setTarget(event.target.value)}>
            {!movies.length && <option value="">No movies yet</option>}
            {movies.map(movie => <option key={movie.id} value={movie.id}>{movie.title}</option>)}
          </select>
        </label>
        {plan && <div className="summary" aria-live="polite">
          <label htmlFor="progress">{plan.watchedCount} of {plan.order.length} watched</label>
          <progress id="progress" value={plan.order.length ? plan.watchedCount : 1} max={plan.order.length || 1} />
          <span className="metric">{duration(plan.remainingMinutes)}</span>
          <p className="meta">Remaining watch time</p>
        </div>}
      </section>
    </div>
  );
}

function Booking({ cinemas, onCinema }) {
  const [cinemaId, setCinemaId] = useState(String(cinemas[0]?.id ?? ''));
  const [result, setResult] = useState(null);
  const [quotePending, setQuotePending] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [cinemaError, setCinemaError] = useState('');
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');
  const cinema = cinemas.find(item => item.id === Number(cinemaId));

  async function quote(event) {
    event.preventDefault();
    const size = Number(new FormData(event.currentTarget).get('groupSize'));
    setQuoteError('');
    setResult(null);
    setQuotePending(true);
    try {
      setResult(await api(`/cinemas/${cinemaId}/booking?groupSize=${encodeURIComponent(size)}`));
    } catch (failure) {
      setQuoteError(failure.message);
    } finally {
      setQuotePending(false);
    }
  }

  async function addCinema(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const sizes = data.get('bundleSizes').split(',').map(size => size.trim());
    if (sizes.some(size => !/^\d+$/.test(size))) {
      setCinemaError('Separate whole-number bundle sizes with commas.');
      return;
    }
    setAdding(true);
    setCinemaError('');
    setNotice('');
    try {
      const added = await api('/cinemas', 'POST', { name: data.get('name'), bundleSizes: sizes.map(Number) });
      onCinema(added);
      if (!cinemaId) setCinemaId(String(added.id));
      form.reset();
      setNotice(`Added ${added.name}.`);
    } catch (failure) {
      setCinemaError(failure.message);
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="workspace">
      <section className="panel" aria-labelledby="quote">
        <div className="panel-header"><h2 id="quote">Booking quote</h2></div>
        <form onSubmit={quote} onChange={() => { setResult(null); setQuoteError(''); }}>
          <fieldset className="fields" disabled={!cinemas.length || quotePending}>
            <label>Cinema
              <select value={cinemaId} onChange={event => setCinemaId(event.target.value)}>
                {!cinemas.length && <option value="">No cinemas yet</option>}
                {cinemas.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            {cinema && <p className="meta">Bundle sizes in seats · {cinema.bundleSizes.join(', ')}</p>}
            <label>Group size<input name="groupSize" type="number" min="1" max="10000" required /></label>
            <div className="actions"><button className="primary">{quotePending ? 'Calculating…' : 'Get quote'}</button></div>
          </fieldset>
        </form>
        <ErrorNotice message={quoteError} />
        <div aria-live="polite">
          {result && <div className="summary">
            {result.possible ? <>
              <h3 className="metric">{result.bundleCount} {result.bundleCount === 1 ? 'bundle' : 'bundles'}</h3>
              <p className="meta">Exactly {result.groupSize} {result.groupSize === 1 ? 'seat' : 'seats'}</p>
              <ul className="bundle-list">
                {result.bundles.map(bundle => <li key={bundle.size}>{bundle.quantity} × {bundle.size}-seat {bundle.quantity === 1 ? 'bundle' : 'bundles'}</li>)}
              </ul>
            </> : <><h3>Not possible</h3><p className="muted">The available bundles cannot make exactly {result.groupSize} seats.</p></>}
          </div>}
        </div>
      </section>
      <section className="panel editor" aria-labelledby="add-cinema">
        <div className="panel-header"><h2 id="add-cinema">Add a cinema</h2></div>
        <form onSubmit={addCinema}>
          <fieldset disabled={adding} className="fields">
            <label>Name<input name="name" required /></label>
            <label>Bundle sizes<input name="bundleSizes" placeholder="2, 5" aria-describedby="bundle-hint" required /></label>
            <p id="bundle-hint" className="meta">Enter 1 to 10 different sizes separated by commas.</p>
            <ErrorNotice message={cinemaError} />
            <div className="actions"><button className="primary">{adding ? 'Saving…' : 'Add cinema'}</button></div>
          </fieldset>
        </form>
        <p className="status" role="status">{notice}</p>
      </section>
    </div>
  );
}

function App() {
  const [view, setView] = useState(activeView);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    setError('');
    try {
      const [movies, cinemas] = await Promise.all([api('/movies'), api('/cinemas')]);
      setData({ movies, cinemas });
    } catch (failure) {
      setError(failure.message);
    }
  }

  useEffect(() => {
    load();
    const changeView = () => setView(activeView());
    window.addEventListener('hashchange', changeView);
    return () => window.removeEventListener('hashchange', changeView);
  }, []);

  function onMovie(movie) {
    setData(current => ({
      ...current,
      movies: [...current.movies.filter(item => item.id !== movie.id), movie].sort((a, b) => a.id - b.id),
    }));
  }

  function onCinema(cinema) {
    setData(current => ({ ...current, cinemas: [...current.cinemas, cinema] }));
  }

  return (
    <>
      <a className="skip-link" href="#main-content" onClick={event => {
        event.preventDefault();
        document.getElementById('main-content').focus();
      }}>Skip to content</a>
      <header className="masthead">
        <div className="wrap header-inner">
          <a className="brand" href="#movies"><span className="brand-mark" aria-hidden="true">D</span>Doomsday Ready</a>
          <nav aria-label="Main navigation">
            {views.map(item => <a key={item.id} href={`#${item.id}`} aria-current={view === item.id ? 'page' : undefined}>{item.label}</a>)}
          </nav>
        </div>
      </header>
      <main id="main-content" className="wrap" tabIndex="-1">
        <div className="intro" data-enter key={view}>
          <h1>{views.find(item => item.id === view).label}</h1>
          <p>{{
            movies: 'Build your MCU library and track what you’ve watched.',
            rewatch: 'Choose a movie to see what to watch first and how long it will take.',
            booking: 'Find the fewest bundles that seat your whole group on opening night.',
          }[view]}</p>
        </div>
        <ErrorNotice message={error} />
        {error && <button type="button" onClick={load}>Retry loading</button>}
        {!data && !error && <p role="status">Loading…</p>}
        {data && view === 'movies' && <Movies movies={data.movies} onMovie={onMovie} />}
        {data && view === 'rewatch' && <Rewatch movies={data.movies} />}
        {data && view === 'booking' && <Booking cinemas={data.cinemas} onCinema={onCinema} />}
      </main>
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
