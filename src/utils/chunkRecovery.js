const CHUNK_RECOVERY_KEY = 'wut:chunk-recovery';

const CHUNK_ERROR_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /importing a module script failed/i,
  /loading chunk [\w-]+ failed/i,
  /chunkloaderror/i,
];

export function isChunkLoadError(error) {
  const message = String(error?.message || error || '');
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export function recoverFromChunkLoadError(error, route, browser = window) {
  if (!isChunkLoadError(error)) return false;

  const location = browser.location;
  const target = route?.fullPath || `${location.pathname}${location.search}${location.hash}`;
  const storage = browser.sessionStorage;

  try {
    if (storage.getItem(CHUNK_RECOVERY_KEY) === target) return false;
    storage.setItem(CHUNK_RECOVERY_KEY, target);
  } catch {}

  location.assign(target);
  return true;
}

export function clearChunkRecoveryMarker(browser = window) {
  try {
    browser.sessionStorage.removeItem(CHUNK_RECOVERY_KEY);
  } catch {}
}
