const SENSITIVE_KEYS = new Set([
  'token', 'access_token', 'refresh_token', 'password', 'secret',
  'authorization', 'cookie', 'api_key', 'apikey', 'client_secret',
  'private_key', 'credential',
]);

function isSensitiveKey(key) {
  return SENSITIVE_KEYS.has(String(key).toLowerCase());
}

export function sanitizeForPersistence(value) {
  if (Array.isArray(value)) return value.map(sanitizeForPersistence);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
      key,
      isSensitiveKey(key) ? '[REDACTED]' : sanitizeForPersistence(nested),
    ]));
  }
  return value;
}
