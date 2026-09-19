import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMemoryNutritionStore,
  createNutritionService,
  createStaticNutritionResolver,
  parseSimpleMealText,
  registerNutritionCapability,
} from '../../src/product/nutrition.mjs';

function fixture() {
  const resolver = createStaticNutritionResolver({
    ovo: { name: 'ovo', defaultGrams: 50, kcalPer100g: 143, proteinPer100g: 12.6, carbsPer100g: 0.7, fatPer100g: 9.5, source: 'TBCA-fixture', sourceRef: 'egg' },
    ovos: { name: 'ovo', defaultGrams: 50, kcalPer100g: 143, proteinPer100g: 12.6, carbsPer100g: 0.7, fatPer100g: 9.5, source: 'TBCA-fixture', sourceRef: 'egg' },
    arroz: { name: 'arroz', defaultGrams: 100, kcalPer100g: 128, proteinPer100g: 2.5, carbsPer100g: 28.1, fatPer100g: 0.2, source: 'TBCA-fixture', sourceRef: 'rice' },
    frango: { name: 'frango', defaultGrams: 100, kcalPer100g: 165, proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 3.6, source: 'USDA-fixture', sourceRef: 'chicken' },
  });
  const store = createMemoryNutritionStore();
  let id = 0;
  const service = createNutritionService({
    store,
    resolver,
    idFactory: () => 'meal-' + ++id,
    now: () => '2026-09-19T12:00:00.000Z',
  });
  return { service, store };
}

test('parses simple Portuguese meal text into structured portions', () => {
  assert.deepEqual(parseSimpleMealText('comi dois ovos e 100g de arroz'), [
    { name: 'ovos', quantity: 2, unit: 'unit' },
    { name: 'arroz', grams: 100 },
  ]);
  assert.deepEqual(parseSimpleMealText('comi frango com arroz'), [
    { name: 'frango com arroz' },
  ]);
});

test('logs meal with deterministic totals and per-item provenance', async () => {
  const { service } = fixture();
  const result = await service.logMeal({
    userId: 'user-1',
    sourceMessageId: 'wa-1',
    sourceType: 'whatsapp',
    items: parseSimpleMealText('comi dois ovos e 100g de arroz'),
  });

  assert.equal(result.duplicate, false);
  assert.equal(result.meal.items.length, 2);
  assert.equal(result.meal.items[0].nutritionSource, 'TBCA-fixture');
  assert.equal(result.meal.items[0].grams, 100);
  assert.equal(result.meal.items[1].grams, 100);
  assert.equal(result.meal.totals.kcal, 271);
  assert.equal(result.dailyTotals.kcal, 271);
});

test('same source message is idempotent and does not duplicate daily calories', async () => {
  const { service, store } = fixture();
  const input = { userId: 'user-1', sourceMessageId: 'wa-2', items: [{ name: 'ovo', quantity: 1, unit: 'unit' }] };
  const first = await service.logMeal(input);
  const second = await service.logMeal(input);

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.meal.id, first.meal.id);
  assert.equal((await store.listMeals({ userId: 'user-1' })).length, 1);
  assert.equal(second.dailyTotals.kcal, 71.5);
});

test('correction preserves prior nutrition facts in an audit revision', async () => {
  const { service } = fixture();
  const created = await service.logMeal({ userId: 'user-1', items: [{ name: 'ovo', quantity: 1, unit: 'unit' }] });
  const corrected = await service.correctMeal(created.meal.id, [{ name: 'ovo', quantity: 2, unit: 'unit' }], 'na verdade eram 2 ovos');

  assert.equal(corrected.totals.kcal, 143);
  assert.equal(corrected.revisions.length, 1);
  assert.equal(corrected.revisions[0].totals.kcal, 71.5);
  assert.equal(corrected.revisions[0].reason, 'na verdade eram 2 ovos');
});

test('soft deletion removes meal from daily totals without destroying its provenance', async () => {
  const { service, store } = fixture();
  const created = await service.logMeal({ userId: 'user-1', items: [{ name: 'arroz', grams: 100 }] });
  const deleted = await service.deleteMeal(created.meal.id);

  assert.equal(deleted.deletedAt, '2026-09-19T12:00:00.000Z');
  assert.equal((await service.dailyTotals('user-1', '2026-09-19')).kcal, 0);
  const stored = await store.getMeal(created.meal.id);
  assert.equal(stored.items[0].nutritionSource, 'TBCA-fixture');
});

test('coaching preference defaults to occasional and accepts explicit opt-out', async () => {
  const { service } = fixture();
  assert.equal(await service.getCoachingPreference('user-1'), 'occasional');
  await service.setCoachingPreference('user-1', 'never');
  assert.equal(await service.getCoachingPreference('user-1'), 'never');
  await assert.rejects(service.setCoachingPreference('user-1', 'maximum'), /unsupported coaching mode/);
});

test('registers nutrition as an approval-gated NaIA capability instead of a parallel framework', async () => {
  const { service } = fixture();
  let captured;
  const naia = {
    registerCapability(definition) { captured = definition; return { name: definition.name, risk: definition.tool.risk }; },
  };
  const registered = registerNutritionCapability(naia, { service, userId: 'user-1' });

  assert.deepEqual(registered, { name: 'nutrition.meal.log', risk: 'LOCAL_WRITE' });
  assert.equal(captured.tool.capability, 'nutrition.diary');
  assert.equal(captured.rule.match({ title: 'comi dois ovos' }), true);
  const action = captured.rule.action({ id: 'msg-1', title: 'comi dois ovos e 100g de arroz' });
  assert.equal(action.requiresApproval, true);
  assert.equal(action.risk, 'LOCAL_WRITE');
  assert.deepEqual(action.input.items[0], { name: 'ovos', quantity: 2, unit: 'unit' });
});
