import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api.js';
import ErrorNotice from './ErrorNotice.jsx';
import Booking from './views/Booking.jsx';
import Movies from './views/Movies.jsx';
import Rewatch from './views/Rewatch.jsx';
import './styles.css';

const views = [
  { id: 'movies', label: 'Movies' },
  { id: 'rewatch', label: 'Rewatch Plan' },
  { id: 'booking', label: 'Booking' },
];
const activeView = () => views.find(view => view.id === location.hash.slice(1))?.id ?? 'movies';

function App() {
  const [view, setView] = useState(activeView);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [savingMovieIds, setSavingMovieIds] = useState([]);

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
    const changeView = () => {
      setView(activeView());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', changeView);
    return () => window.removeEventListener('hashchange', changeView);
  }, []);

  async function saveMovie(id, changes) {
    // Keep the save state here so changing views cannot unlock a pending movie.
    if (id !== null) setSavingMovieIds(current => [...current, id]);
    try {
      const movie = await api(id === null ? '/movies' : `/movies/${id}`, id === null ? 'POST' : 'PATCH', changes);
      setData(current => ({
        ...current,
        movies: [...current.movies.filter(item => item.id !== movie.id), movie].sort((a, b) => a.id - b.id),
      }));
      return movie;
    } finally {
      if (id !== null) setSavingMovieIds(current => current.filter(movieId => movieId !== id));
    }
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
          <nav aria-label="Main navigation" style={{ '--active-view': views.findIndex(item => item.id === view) }}>
            {views.map(item => <a key={item.id} href={`#${item.id}`} aria-current={view === item.id ? 'page' : undefined}>{item.label}</a>)}
          </nav>
        </div>
      </header>
      <main id="main-content" className="wrap" tabIndex="-1">
        <div className="intro" data-enter key={view}>
          <h1>{views.find(item => item.id === view).label}</h1>
          <p>{{
            movies: 'Build your MCU library and track what you’ve watched.',
            rewatch: 'See what to watch before your target movie and how much time you’ll need.',
            booking: 'Find the fewest bundles that seat your whole group on opening night.',
          }[view]}</p>
        </div>
        <ErrorNotice message={error} />
        {error && <button type="button" onClick={load}>Retry loading</button>}
        {!data && !error && <p role="status">Loading…</p>}
        {data && view === 'movies' && <Movies movies={data.movies} saveMovie={saveMovie} savingMovieIds={savingMovieIds} />}
        {data && view === 'rewatch' && <Rewatch movies={data.movies} />}
        {data && view === 'booking' && <Booking cinemas={data.cinemas} onCinema={onCinema} />}
      </main>
    </>
  );
}

createRoot(document.getElementById('root')).render(<App />);
