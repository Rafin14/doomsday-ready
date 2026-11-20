import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bookingQuote, rewatchOrder } from '../server/algorithms.js';

// Breadth-first search reaches seat totals in order of bundle count.
function minimumBundlesBySearch(sizes, maxSeats) {
  const minimum = new Map([[0, 0]]);
  const queue = [0];
  for (const seats of queue) {
    for (const size of sizes) {
      const next = seats + size;
      if (next > maxSeats || minimum.has(next)) continue;
      minimum.set(next, minimum.get(seats) + 1);
      queue.push(next);
    }
  }
  return minimum;
}

test('booking matches an independent search for every small bundle set and target', () => {
  const candidates = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const maxSeats = 40;
  for (let mask = 1; mask < 2 ** candidates.length; mask++) {
    const sizes = candidates.filter((_, bit) => mask & (1 << bit));
    const expected = minimumBundlesBySearch(sizes, maxSeats);
    for (let groupSize = 1; groupSize <= maxSeats; groupSize++) {
      const quote = bookingQuote(sizes, groupSize);
      const context = `bundles [${sizes}] for ${groupSize} seats`;
      assert.equal(quote.possible, expected.has(groupSize), context);
      if (!quote.possible) continue;
      assert.equal(quote.bundleCount, expected.get(groupSize), context);
      let seats = 0;
      let bundles = 0;
      for (const { size, quantity } of quote.bundles) {
        assert.ok(sizes.includes(size) && Number.isInteger(quantity) && quantity > 0, context);
        seats += size * quantity;
        bundles += quantity;
      }
      assert.equal(seats, groupSize, context);
      assert.equal(bundles, quote.bundleCount, context);
    }
  }
});

test('rewatch order matches reachability for every directed four-movie graph without self-links', () => {
  const movies = [0, 1, 2, 3];
  const edges = movies.flatMap(from => movies.filter(to => from !== to).map(to => [from, to]));
  for (let mask = 0; mask < 2 ** edges.length; mask++) {
    const graph = new Map(movies.map(movie => [movie, []]));
    edges.forEach(([from, to], bit) => {
      if (mask & (1 << bit)) graph.get(from).push(to);
    });
    const reachable = movies.map(movie => new Set(graph.get(movie)));
    for (const via of movies) {
      for (const from of movies) {
        if (!reachable[from].has(via)) continue;
        for (const to of reachable[via]) reachable[from].add(to);
      }
    }

    for (const target of movies) {
      const order = rewatchOrder(target, graph);
      const needed = reachable[target];
      const hasCycle = [...needed].some(movie => reachable[movie].has(movie));
      const context = `graph ${mask}, target ${target}`;
      if (hasCycle) {
        assert.equal(order, null, context);
        continue;
      }
      assert.ok(Array.isArray(order), context);
      assert.deepEqual(order.toSorted(), [...needed].toSorted(), context);
      for (const movie of order) {
        for (const prerequisite of graph.get(movie)) {
          assert.ok(order.indexOf(prerequisite) < order.indexOf(movie), context);
        }
      }
    }
  }
});
