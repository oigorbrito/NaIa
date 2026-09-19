import { randomUUID } from 'node:crypto';

const COACHING_MODES = new Set(['never', 'occasional', 'frequent', 'always']);
const NUMBER_WORDS = new Map([['um', 1], ['uma', 1], ['dois', 2], ['duas', 2], ['tres', 3], ['três', 3]]);

function clone(value) { return structuredClone(value); }
function round(value, digits = 2) { return Number(Number(value ?? 0).toFixed(digits)); }
function normalizeName(value) {
  return String(value ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}
function dayKey(iso) { return String(iso).slice(0, 10); }

export function parseSimpleMealText(text) {
  const cleaned = String(text ?? '').trim().replace(/^comi\s+/i, '');
  if (!cleaned) return [];
  return cleaned.split(/\s+e\s+|\s*,\s*/i).filter(Boolean).map((part) => {
    const grams = part.match(/^(\d+(?:[.,]\d+)?)\s*g(?:ramas?)?\s+(?:de\s+)?(.+)$/i);
    if (grams) return { name: grams[2].trim(), grams: Number(grams[1].replace(',', '.')) };
    const counted = part.match(/^(\d+(?:[.,]\d+)?|um|uma|dois|duas|tres|três)\s+(.+)$/i);
    if (counted) {
      const raw = counted[1].toLowerCase();
      const quantity = NUMBER_WORDS.get(raw) ?? Number(raw.replace(',', '.'));
      return { name: counted[2].trim(), quantity, unit: 'unit' };
    }
    return { name: part.trim() };
  });
}

export function createStaticNutritionResolver(catalog = {}) {
  const entries = new Map(Object.entries(catalog).map(([name, value]) => [normalizeName(name), clone(value)]));
  return {
    async resolve(item) {
      const key = normalizeName(item?.name);
      const entry = entries.get(key);
      if (!entry) throw new Error('nutrition item not found: ' + item?.name);
      const explicitGrams = Number.isFinite(item?.grams) ? Number(item.grams) : null;
      const quantity = Number.isFinite(item?.quantity) ? Number(item.quantity) : null;
      const grams = explicitGrams ?? (quantity !== null ? quantity * Number(entry.defaultGrams ?? 100) : Number(entry.defaultGrams ?? 100));
      const factor = grams / 100;
      const estimated = explicitGrams === null && quantity === null;
      return {
        reportedName: String(item.name).trim(),
        normalizedName: entry.name ?? String(item.name).trim(),
        quantity: quantity ?? (explicitGrams !== null ? explicitGrams : 1),
        unit: explicitGrams !== null ? 'g' : (item?.unit ?? 'portion'),
        grams: round(grams, 1),
        kcal: round(Number(entry.kcalPer100g ?? 0) * factor, 1),
        proteinG: round(Number(entry.proteinPer100g ?? 0) * factor, 1),
        carbsG: round(Number(entry.carbsPer100g ?? 0) * factor, 1),
        fatG: round(Number(entry.fatPer100g ?? 0) * factor, 1),
        nutritionSource: entry.source ?? 'static-catalog',
        sourceRef: entry.sourceRef ?? null,
        confidence: estimated ? 'LOW' : (entry.confidence ?? 'HIGH'),
        estimated,
      };
    },
  };
}

export function createMemoryNutritionStore() {
  const meals = new Map();
  const sourceIndex = new Map();
  const preferences = new Map();
  return {
    async saveMeal(meal) {
      meals.set(meal.id, clone(meal));
      if (meal.sourceMessageId) sourceIndex.set(meal.userId + ':' + meal.sourceMessageId, meal.id);
      return clone(meal);
    },
    async getMeal(id) { const value = meals.get(id); return value ? clone(value) : null; },
    async findBySourceMessageId(userId, sourceMessageId) {
      const id = sourceIndex.get(userId + ':' + sourceMessageId);
      return id ? clone(meals.get(id)) : null;
    },
    async listMeals({ userId, date } = {}) {
      return [...meals.values()].filter((meal) =>
        (!userId || meal.userId === userId) && (!date || dayKey(meal.occurredAt) === date)
      ).map(clone);
    },
    async savePreference(userId, mode) { preferences.set(userId, mode); return mode; },
    async getPreference(userId) { return preferences.get(userId) ?? 'occasional'; },
  };
}

function totalsFor(items) {
  return items.reduce((total, item) => {
    total.kcal += item.kcal;
    total.proteinG += item.proteinG;
    total.carbsG += item.carbsG;
    total.fatG += item.fatG;
    return total;
  }, { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 });
}

function roundedTotals(total) {
  return { kcal: round(total.kcal, 1), proteinG: round(total.proteinG, 1), carbsG: round(total.carbsG, 1), fatG: round(total.fatG, 1) };
}

export function createNutritionService({
  store = createMemoryNutritionStore(),
  resolver,
  now = () => new Date().toISOString(),
  idFactory = randomUUID,
} = {}) {
  if (!resolver || typeof resolver.resolve !== 'function') throw new Error('nutrition resolver is required');

  async function resolveItems(items) {
    if (!Array.isArray(items) || items.length === 0) throw new Error('at least one meal item is required');
    const resolved = [];
    for (const item of items) resolved.push(await resolver.resolve(item));
    return resolved;
  }

  async function dailyTotals(userId, date) {
    const meals = await store.listMeals({ userId, date });
    const active = meals.filter((meal) => !meal.deletedAt);
    return roundedTotals(active.reduce((sum, meal) => {
      sum.kcal += meal.totals.kcal;
      sum.proteinG += meal.totals.proteinG;
      sum.carbsG += meal.totals.carbsG;
      sum.fatG += meal.totals.fatG;
      return sum;
    }, { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }));
  }

  return {
    async logMeal({ userId, sourceMessageId = null, sourceType = 'text', occurredAt = now(), items }) {
      if (!userId) throw new Error('userId is required');
      if (sourceMessageId) {
        const existing = await store.findBySourceMessageId(userId, sourceMessageId);
        if (existing) return { meal: existing, duplicate: true, dailyTotals: await dailyTotals(userId, dayKey(existing.occurredAt)) };
      }
      const resolvedItems = await resolveItems(items);
      const meal = {
        id: idFactory(), userId, sourceMessageId, sourceType, occurredAt,
        items: resolvedItems, totals: roundedTotals(totalsFor(resolvedItems)),
        revisions: [], deletedAt: null, createdAt: now(), updatedAt: now(),
      };
      await store.saveMeal(meal);
      return { meal: clone(meal), duplicate: false, dailyTotals: await dailyTotals(userId, dayKey(occurredAt)) };
    },

    async correctMeal(mealId, items, reason = 'user-correction') {
      const meal = await store.getMeal(mealId);
      if (!meal) throw new Error('meal not found: ' + mealId);
      if (meal.deletedAt) throw new Error('cannot correct deleted meal');
      const resolvedItems = await resolveItems(items);
      meal.revisions.push({ at: now(), reason, items: clone(meal.items), totals: clone(meal.totals) });
      meal.items = resolvedItems;
      meal.totals = roundedTotals(totalsFor(resolvedItems));
      meal.updatedAt = now();
      await store.saveMeal(meal);
      return clone(meal);
    },

    async deleteMeal(mealId) {
      const meal = await store.getMeal(mealId);
      if (!meal) throw new Error('meal not found: ' + mealId);
      if (!meal.deletedAt) { meal.deletedAt = now(); meal.updatedAt = meal.deletedAt; await store.saveMeal(meal); }
      return clone(meal);
    },

    async dailyTotals(userId, date = dayKey(now())) { return dailyTotals(userId, date); },

    async setCoachingPreference(userId, mode) {
      if (!COACHING_MODES.has(mode)) throw new Error('unsupported coaching mode: ' + mode);
      return store.savePreference(userId, mode);
    },
    async getCoachingPreference(userId) { return store.getPreference(userId); },
  };
}

export function registerNutritionCapability(naia, { service, userId }) {
  if (!naia || typeof naia.registerCapability !== 'function') throw new Error('NaIA capability registration is required');
  if (!service || typeof service.logMeal !== 'function') throw new Error('nutrition service is required');
  if (!userId) throw new Error('userId is required');
  return naia.registerCapability({
    name: 'nutrition.meal.log',
    tool: {
      risk: 'LOCAL_WRITE',
      capability: 'nutrition.diary',
      description: 'Logs a meal with nutrition provenance and idempotency',
      async run(input) { return service.logMeal({ userId, ...input }); },
    },
    rule: {
      name: 'nutrition-meal-log',
      match: ({ title }) => /^comi\s+/i.test(String(title ?? '').trim()),
      action: ({ title, id }) => ({
        tool: 'nutrition.meal.log',
        input: { sourceMessageId: id, sourceType: 'chat', items: parseSimpleMealText(title) },
        risk: 'LOCAL_WRITE',
        requiresApproval: true,
      }),
    },
  });
}
