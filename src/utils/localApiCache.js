const CACHE_PREFIX = "starkHubApiCache:v1:";
const memoryCache = new Map();
const inflight = new Map();

function now() {
  return Date.now();
}

function canUseStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value)
    .sort()
    .reduce((acc, key) => {
      acc[key] = normalize(value[key]);
      return acc;
    }, {});
}

export function stableSignature(value) {
  try {
    return JSON.stringify(normalize(value));
  } catch {
    return String(now());
  }
}

export function buildApiCacheKey(...parts) {
  return parts
    .flat()
    .map((part) => String(part ?? "none").trim().replace(/[^a-zA-Z0-9_.:-]+/g, "_").slice(0, 120))
    .join(":");
}

function fullKey(key) {
  return `${CACHE_PREFIX}${key}`;
}

export function readApiCache(key, ttlMs = 0) {
  if (!key) return null;
  const fromMemory = memoryCache.get(key);
  if (fromMemory) {
    return {
      ...fromMemory,
      fresh: ttlMs > 0 ? now() - fromMemory.timestamp < ttlMs : false
    };
  }
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(fullKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    memoryCache.set(key, parsed);
    return {
      ...parsed,
      fresh: ttlMs > 0 ? now() - parsed.timestamp < ttlMs : false
    };
  } catch {
    return null;
  }
}

export function writeApiCache(key, data, signature = stableSignature(data)) {
  if (!key) return null;
  const entry = { data, signature, timestamp: now() };
  memoryCache.set(key, entry);
  if (canUseStorage()) {
    try {
      window.localStorage.setItem(fullKey(key), JSON.stringify(entry));
    } catch {
      // Quota/localStorage disabled: memory cache still keeps navigation fast.
    }
  }
  return entry;
}

export function updateApiCache(key, updater) {
  const current = readApiCache(key);
  const nextData = updater(current?.data);
  return writeApiCache(key, nextData);
}

export function clearApiCache(keyPrefix = "") {
  [...memoryCache.keys()].forEach((key) => {
    if (!keyPrefix || key.startsWith(keyPrefix)) memoryCache.delete(key);
  });
  if (!canUseStorage()) return;
  Object.keys(window.localStorage).forEach((key) => {
    if (key.startsWith(CACHE_PREFIX) && (!keyPrefix || key.slice(CACHE_PREFIX.length).startsWith(keyPrefix))) {
      window.localStorage.removeItem(key);
    }
  });
}

export async function withInflight(key, task) {
  if (!key) return task();
  if (inflight.has(key)) return inflight.get(key);
  const promise = Promise.resolve()
    .then(task)
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}
