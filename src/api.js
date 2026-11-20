export async function api(path, method = 'GET', body) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      ...(body && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error('Could not connect to the app. Try again.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || data === null) throw new Error(data?.message || 'The server returned an unexpected response. Try again.');
  return data;
}
