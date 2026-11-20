import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import express from 'express';
import { chromium } from 'playwright-core';
import { createApp } from '../server/api.js';
import { openDatabase } from '../server/db.js';

let browser;
let db;
let server;
let page;
let url;

before(async () => {
  browser = await chromium.launch({ channel: 'chrome' });
});

beforeEach(async () => {
  db = openDatabase(':memory:');
  const app = createApp(db);
  app.use(express.static('dist'));
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  url = `http://127.0.0.1:${server.address().port}/`;
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(5000);
});

afterEach(async () => {
  await page?.close();
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  db?.close();
});

after(async () => {
  await browser?.close();
});

const button = (name, scope = page) => scope.getByRole('button', { name, exact: true });
const heading = (name, level) => page.getByRole('heading', { name, level, exact: true });
const navigate = name => page.getByRole('link', { name, exact: true }).click();
const show = locator => locator.waitFor({ state: 'visible' });

test('movie form blocks a future year, accepts the current year and restores keyboard focus', async () => {
  await page.goto(url);
  const add = page.getByRole('region', { name: 'Add a movie' });
  const title = add.getByLabel('Title');
  const year = add.getByLabel('Release year');
  const currentYear = new Date().getUTCFullYear();
  await title.fill('Browser test film');
  await year.fill(String(currentYear + 1));
  await add.getByLabel('Runtime (min)').fill('90');
  assert.equal(await year.evaluate(input => input.validity.rangeOverflow), true);
  await button('Add movie', add).click();
  assert.equal(await heading('Browser test film').count(), 0);
  await year.fill(String(currentYear));
  await add.getByLabel('The Avengers', { exact: true }).check();
  await button('Add movie', add).click();
  await show(heading('Browser test film'));
  assert.equal(await title.inputValue(), '');
  assert.equal(await title.evaluate(input => input === document.activeElement), true);

  const edit = button('Edit prerequisites for Iron Man');
  await edit.click();
  const editor = page.locator('.inline-editor');
  await editor.getByLabel('Avengers: Endgame', { exact: true }).check();
  await button('Save prerequisites', editor).click();
  await show(editor.getByRole('alert'));
  await button('Cancel', editor).click();
  assert.equal(await edit.evaluate(input => input === document.activeElement), true);

  await edit.click();
  await editor.getByLabel('Thor: Ragnarok', { exact: true }).check();
  await button('Save prerequisites', editor).click();
  await show(page.getByText('Prerequisites saved for Iron Man.'));
  assert.equal(await edit.evaluate(input => input === document.activeElement), true);
});

test('a pending prerequisite edit stays locked when switching views', { timeout: 15_000 }, async () => {
  let releaseSave;
  const pendingSave = new Promise(resolve => { releaseSave = resolve; });
  let saveStarted;
  const saveRequest = new Promise(resolve => { saveStarted = resolve; });
  await page.route('**/api/movies/1', async route => {
    saveStarted();
    await pendingSave;
    await route.continue();
  });

  try {
    await page.goto(url);
    const edit = button('Edit prerequisites for Iron Man');
    await edit.click();
    const editor = page.locator('.inline-editor');
    await editor.getByLabel('Thor: Ragnarok', { exact: true }).check();
    await button('Save prerequisites', editor).click();
    await saveRequest;

    await navigate('Booking');
    await show(heading('Booking', 1));
    await navigate('Movies');
    await show(edit);
    assert.equal(await edit.isDisabled(), true);
    assert.equal(await page.getByRole('checkbox', { name: 'Watched: Iron Man', exact: true }).isDisabled(), true);
    const response = page.waitForResponse(result => result.url().endsWith('/api/movies/1') && result.request().method() === 'PATCH');
    releaseSave();
    assert.equal((await response).status(), 200);
    await edit.click();
    assert.equal(await editor.getByLabel('Thor: Ragnarok', { exact: true }).isChecked(), true);
  } finally {
    releaseSave();
  }
});

test('watch progress and booking quotes work across desktop and mobile widths', async () => {
  await page.goto(url);
  const ironMan = page.getByRole('checkbox', { name: 'Watched: Iron Man', exact: true });
  await ironMan.click();
  await show(page.getByText('1 of 8 watched', { exact: true }));
  await navigate('Rewatch Plan');
  await show(page.getByText('1 of 7 watched', { exact: true }));
  await show(page.getByText('14 hr 34 min', { exact: true }));
  await page.getByLabel('Target movie').selectOption({ label: 'Thor: Ragnarok' });
  await show(page.getByText('This movie has no prerequisites.'));
  await show(page.getByText('0 min', { exact: true }));

  await navigate('Booking');
  const bookingQuote = page.getByRole('region', { name: 'Booking quote' });
  const cinema = bookingQuote.getByLabel('Cinema');
  const sizes = page.getByRole('list', { name: 'Available bundle sizes' });
  assert.deepEqual(await sizes.getByRole('listitem').allTextContents(), ['1 seat', '3 seats', '4 seats']);
  await page.getByLabel('Group size').fill('6');
  await button('Get quote').click();
  await show(page.getByText('2 × 3-seat bundles', { exact: true }));
  await cinema.selectOption({ label: 'Rex Theatre' });
  assert.equal(await page.getByText('2 × 3-seat bundles', { exact: true }).count(), 0);
  await page.getByLabel('Group size').fill('7');
  await button('Get quote').click();
  await show(heading('Not possible'));
  const addCinema = page.getByRole('region', { name: 'Add a cinema' });
  await addCinema.getByLabel('Name', { exact: true }).fill('Browser cinema');
  await addCinema.getByLabel('Bundle sizes').fill('2, 7');
  await button('Add cinema', addCinema).click();
  await show(addCinema.getByRole('status').filter({ hasText: 'Added Browser cinema.' }));
  await cinema.selectOption({ label: 'Browser cinema' });
  await page.getByLabel('Group size').fill('9');
  await button('Get quote').click();
  await show(page.getByText('1 × 7-seat bundle', { exact: true }));

  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const view of ['Movies', 'Rewatch Plan', 'Booking']) {
      await navigate(view);
      await show(heading(view, 1));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${view} at ${width}px`);
    }
  }
});

test('unexpected API responses are actionable and keyboard controls work with reduced motion', async () => {
  await page.route('**/api/movies', route => route.fulfill({ status: 502, contentType: 'text/html', body: '<p>Unavailable</p>' }), { times: 1 });
  await page.goto(url);
  await show(page.getByRole('alert').filter({ hasText: 'The server returned an unexpected response.' }));
  await button('Retry loading').click();
  await show(heading('Movie library'));
  await page.reload();
  await show(heading('Movie library'));
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Skip to content');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'main-content');
  assert.equal(await page.locator('[data-enter]').evaluate(element => getComputedStyle(element).animationName), 'none');
  assert.equal(await page.locator('nav').evaluate(element => getComputedStyle(element, '::before').transitionDuration), '0s');
});
