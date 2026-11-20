// Return prerequisite IDs in postorder, or null when the target reaches a cycle.
export function rewatchOrder(target, prerequisites) {
  const order = [];
  const onPath = new Set([target]);
  const visited = new Set();
  const stack = [{ id: target, remaining: (prerequisites.get(target) ?? []).values() }];

  while (stack.length) {
    const { id, remaining } = stack.at(-1);
    const next = remaining.next();
    if (next.done) {
      stack.pop();
      onPath.delete(id);
      visited.add(id);
      if (id !== target) order.push(id);
    } else if (onPath.has(next.value)) {
      return null;
    } else if (!visited.has(next.value)) {
      onPath.add(next.value);
      stack.push({ id: next.value, remaining: (prerequisites.get(next.value) ?? []).values() });
    }
  }
  return order;
}

export function bookingQuote(sizes, groupSize) {
  // Each reachable seat total keeps the cheapest count and the final bundle used.
  const fewest = Array(groupSize + 1).fill(Infinity);
  const lastBundle = Array(groupSize + 1);
  const descending = sizes.toSorted((a, b) => b - a);
  fewest[0] = 0;

  for (let seats = 1; seats <= groupSize; seats++) {
    for (const size of descending) {
      if (size <= seats && fewest[seats - size] + 1 < fewest[seats]) {
        fewest[seats] = fewest[seats - size] + 1;
        lastBundle[seats] = size;
      }
    }
  }

  if (!Number.isFinite(fewest[groupSize])) return { possible: false, groupSize };
  const counts = new Map();
  for (let seats = groupSize; seats > 0;) {
    const size = lastBundle[seats];
    counts.set(size, (counts.get(size) ?? 0) + 1);
    seats -= size;
  }

  return {
    possible: true,
    groupSize,
    bundleCount: fewest[groupSize],
    bundles: descending.filter(size => counts.has(size)).map(size => ({ size, quantity: counts.get(size) })),
  };
}
