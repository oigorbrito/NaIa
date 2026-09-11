import { createDefaultCapabilityRegistry } from './capabilities.mjs';
import { createCalendarCapabilities, createCalendarExecutionAdapter } from './calendar.mjs';
import { createCalendarHttpProvider } from './calendar-http.mjs';
import { createGoogleCalendarProvider } from './google-calendar.mjs';
import { createHttpReadAdapter, createHttpReadCapability } from './http-read.mjs';

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

export function createRuntimeComposition({ env = process.env } = {}) {
  const capabilities = createDefaultCapabilityRegistry();
  const executionAdapters = [];

  const httpBaseUrl = String(env.NAIA_HTTP_BASE_URL ?? '').trim();
  if (httpBaseUrl) {
    const prefix = String(env.NAIA_HTTP_PREFIX ?? 'provider-read').trim();
    const tool = String(env.NAIA_HTTP_TOOL ?? 'http.read').trim();
    const timeoutMs = positiveInteger(env.NAIA_HTTP_TIMEOUT_MS, 5000, 'NAIA_HTTP_TIMEOUT_MS');
    const maxBytes = positiveInteger(env.NAIA_HTTP_MAX_BYTES, 256 * 1024, 'NAIA_HTTP_MAX_BYTES');

    capabilities.register(createHttpReadCapability({ id: tool, prefix, tool }));
    executionAdapters.push(createHttpReadAdapter({ baseUrl: httpBaseUrl, tool, timeoutMs, maxBytes }));
  }

  const calendarBaseUrl = String(env.NAIA_CALENDAR_BASE_URL ?? '').trim();
  const googleCalendarToken = String(env.NAIA_GOOGLE_CALENDAR_ACCESS_TOKEN ?? '').trim();
  if (calendarBaseUrl && googleCalendarToken) {
    throw new Error('multiple calendar providers configured; select generic or Google Calendar');
  }

  let calendarProvider = null;
  if (calendarBaseUrl) {
    const timeoutMs = positiveInteger(env.NAIA_CALENDAR_TIMEOUT_MS, 5000, 'NAIA_CALENDAR_TIMEOUT_MS');
    const maxBytes = positiveInteger(env.NAIA_CALENDAR_MAX_BYTES, 256 * 1024, 'NAIA_CALENDAR_MAX_BYTES');
    calendarProvider = createCalendarHttpProvider({
      baseUrl: calendarBaseUrl,
      token: env.NAIA_CALENDAR_TOKEN ?? '',
      timeoutMs,
      maxBytes,
    });
  } else if (googleCalendarToken) {
    const timeoutMs = positiveInteger(env.NAIA_GOOGLE_CALENDAR_TIMEOUT_MS, 5000, 'NAIA_GOOGLE_CALENDAR_TIMEOUT_MS');
    const maxBytes = positiveInteger(env.NAIA_GOOGLE_CALENDAR_MAX_BYTES, 256 * 1024, 'NAIA_GOOGLE_CALENDAR_MAX_BYTES');
    calendarProvider = createGoogleCalendarProvider({
      accessToken: googleCalendarToken,
      calendarId: env.NAIA_GOOGLE_CALENDAR_ID ?? 'primary',
      apiBaseUrl: env.NAIA_GOOGLE_CALENDAR_API_BASE_URL ?? 'https://www.googleapis.com',
      timeoutMs,
      maxBytes,
    });
  }

  if (calendarProvider) {
    for (const capability of createCalendarCapabilities()) capabilities.register(capability);
    executionAdapters.push(createCalendarExecutionAdapter({ provider: calendarProvider }));
  }

  return { capabilities, executionAdapters };
}
