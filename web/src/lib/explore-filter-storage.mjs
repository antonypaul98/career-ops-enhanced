// Preferences only: no jobs, candidate facts, model choice, or automatic scans.
const KEY = 'career-ops:explore-filters';

export function saveExploreFilters(filters, storage) {
  try {
    (storage ?? globalThis.localStorage).setItem(KEY, JSON.stringify({ v: 1, filters }));
  } catch {
    // Disabled/full browser storage must not break the current search.
  }
}

export function restoreExploreFilters(seed, normalize, storage) {
  try {
    const saved = JSON.parse((storage ?? globalThis.localStorage).getItem(KEY) || 'null');
    if (saved?.v !== 1 || !saved.filters || typeof saved.filters !== 'object' || Array.isArray(saved.filters)) return seed;
    // Reuse the shared search codec; stored values never bypass filter validation.
    return normalize(saved.filters, seed);
  } catch {
    return seed;
  }
}
