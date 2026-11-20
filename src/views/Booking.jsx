import React, { useState } from 'react';
import { api } from '../api.js';
import ErrorNotice from '../ErrorNotice.jsx';

export default function Booking({ cinemas, onCinema }) {
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
            {cinema && <div className="bundle-options">
              <p className="meta" id="bundle-options">Available bundle sizes</p>
              <ul aria-labelledby="bundle-options">
                {cinema.bundleSizes.map(size => <li key={size}>{size} {size === 1 ? 'seat' : 'seats'}</li>)}
              </ul>
            </div>}
            <label>Group size<input name="groupSize" type="number" min="1" max="10000" required /></label>
            <div className="actions"><button className="primary">{quotePending ? 'Calculating…' : 'Get quote'}</button></div>
          </fieldset>
        </form>
        <ErrorNotice message={quoteError} />
        <div aria-live="polite">
          {result && <div className={result.possible ? 'summary' : 'summary impossible'}>
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
