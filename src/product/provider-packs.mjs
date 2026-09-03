import { CapabilityRisk } from './capabilities.mjs';

export const Provider = Object.freeze({
  GITHUB: 'github',
  GMAIL: 'gmail',
  GOOGLE_CALENDAR: 'google-calendar',
});

function objectSchema({ required = [], properties = {} } = {}) {
  return { type: 'object', additionalProperties: false, required, properties };
}

const string = (options = {}) => ({ type: 'string', ...options });
const integer = (options = {}) => ({ type: 'integer', ...options });
const array = (items, options = {}) => ({ type: 'array', items, ...options });

export const PROVIDER_CAPABILITY_PACKS = Object.freeze([
  {
    id: 'github.core',
    provider: Provider.GITHUB,
    version: 1,
    capabilities: [
      {
        name: 'github.issue.read',
        risk: CapabilityRisk.READ_ONLY,
        scopes: ['github:issues:read'],
        description: 'Read one GitHub issue.',
        inputSchema: objectSchema({
          required: ['repository', 'issue'],
          properties: { repository: string({ minLength: 3 }), issue: integer({ minimum: 1 }) },
        }),
      },
      {
        name: 'github.issue.create',
        risk: CapabilityRisk.EXTERNAL_WRITE,
        scopes: ['github:issues:write'],
        description: 'Create a GitHub issue.',
        inputSchema: objectSchema({
          required: ['repository', 'title'],
          properties: { repository: string({ minLength: 3 }), title: string({ minLength: 1 }), body: string() },
        }),
      },
      {
        name: 'github.pull_request.read',
        risk: CapabilityRisk.READ_ONLY,
        scopes: ['github:pull_requests:read'],
        description: 'Read one GitHub pull request.',
        inputSchema: objectSchema({
          required: ['repository', 'pullRequest'],
          properties: { repository: string({ minLength: 3 }), pullRequest: integer({ minimum: 1 }) },
        }),
      },
    ],
  },
  {
    id: 'gmail.core',
    provider: Provider.GMAIL,
    version: 1,
    capabilities: [
      {
        name: 'gmail.message.search',
        risk: CapabilityRisk.READ_ONLY,
        scopes: ['gmail:messages:read'],
        description: 'Search Gmail messages using a Gmail query.',
        inputSchema: objectSchema({
          required: ['query'],
          properties: { query: string({ minLength: 1 }), maxResults: integer({ minimum: 1, maximum: 100 }) },
        }),
      },
      {
        name: 'gmail.message.read',
        risk: CapabilityRisk.READ_ONLY,
        scopes: ['gmail:messages:read'],
        description: 'Read one Gmail message by id.',
        inputSchema: objectSchema({ required: ['messageId'], properties: { messageId: string({ minLength: 1 }) } }),
      },
      {
        name: 'gmail.message.send',
        risk: CapabilityRisk.EXTERNAL_WRITE,
        scopes: ['gmail:messages:send'],
        description: 'Send an email through Gmail.',
        inputSchema: objectSchema({
          required: ['to', 'subject', 'body'],
          properties: {
            to: array(string({ minLength: 3 }), { minItems: 1 }),
            subject: string({ minLength: 1 }),
            body: string(),
          },
        }),
      },
    ],
  },
  {
    id: 'google-calendar.core',
    provider: Provider.GOOGLE_CALENDAR,
    version: 1,
    capabilities: [
      {
        name: 'calendar.events.list',
        risk: CapabilityRisk.READ_ONLY,
        scopes: ['calendar:events:read'],
        description: 'List calendar events in a time window.',
        inputSchema: objectSchema({
          properties: { start: string({ format: 'date-time' }), end: string({ format: 'date-time' }), calendarId: string() },
        }),
      },
      {
        name: 'calendar.free_busy.read',
        risk: CapabilityRisk.READ_ONLY,
        scopes: ['calendar:free_busy:read'],
        description: 'Read free/busy state for a time window.',
        inputSchema: objectSchema({
          required: ['start', 'end'],
          properties: { start: string({ format: 'date-time' }), end: string({ format: 'date-time' }) },
        }),
      },
      {
        name: 'calendar.event.create',
        risk: CapabilityRisk.EXTERNAL_WRITE,
        scopes: ['calendar:events:write'],
        description: 'Create a calendar event.',
        inputSchema: objectSchema({
          required: ['summary', 'start', 'end'],
          properties: {
            summary: string({ minLength: 1 }), start: string({ format: 'date-time' }), end: string({ format: 'date-time' }),
            attendees: array(string({ minLength: 3 })), location: string(), description: string(),
          },
        }),
      },
    ],
  },
]);

export function listProviderPacks() {
  return PROVIDER_CAPABILITY_PACKS.map((pack) => ({
    id: pack.id,
    provider: pack.provider,
    version: pack.version,
    capabilities: pack.capabilities.map((capability) => capability.name),
  }));
}

export function providerCapabilityDescriptors() {
  return PROVIDER_CAPABILITY_PACKS.flatMap((pack) => pack.capabilities.map((capability) => ({
    ...capability,
    provider: pack.provider,
    pack: pack.id,
    packVersion: pack.version,
  })));
}

function validateValue(value, schema, path) {
  if (!schema) return;
  if (schema.type === 'string') {
    if (typeof value !== 'string') throw new Error(`${path} must be a string`);
    if (schema.minLength != null && value.length < schema.minLength) throw new Error(`${path} is too short`);
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) throw new Error(`${path} must be a date-time`);
    return;
  }
  if (schema.type === 'integer') {
    if (!Number.isInteger(value)) throw new Error(`${path} must be an integer`);
    if (schema.minimum != null && value < schema.minimum) throw new Error(`${path} must be >= ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) throw new Error(`${path} must be <= ${schema.maximum}`);
    return;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
    if (schema.minItems != null && value.length < schema.minItems) throw new Error(`${path} requires at least ${schema.minItems} item(s)`);
    value.forEach((item, index) => validateValue(item, schema.items, `${path}[${index}]`));
    return;
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`);
    for (const key of schema.required ?? []) if (!(key in value)) throw new Error(`${path}.${key} is required`);
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) if (!(key in (schema.properties ?? {}))) throw new Error(`${path}.${key} is not allowed`);
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) if (key in value) validateValue(value[key], child, `${path}.${key}`);
  }
}

export function validateCapabilityInput(descriptor, input) {
  validateValue(input ?? {}, descriptor?.inputSchema ?? objectSchema(), 'input');
  return input ?? {};
}

export function findProviderCapability(name) {
  return providerCapabilityDescriptors().find((capability) => capability.name === name) ?? null;
}
