import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMediaClassificationService,
  createMemoryMediaClassificationStore,
  createSignalMediaClassifier,
  normalizeClassificationResult,
  registerMediaClassificationCapabilities,
} from '../../src/product/media-classification.mjs';

test('normalizes supported semantic labels with confidence and provenance', () => {
  assert.deepEqual(normalizeClassificationResult({ labels: [
    { category: 'meme', confidence: 0.91, reasons: ['ocr-top-bottom-text'] },
    { category: 'other', confidence: 1 },
  ] }, { classifier: 'fixture' }), [
    { category: 'MEME', confidence: 0.91, provenance: 'fixture', reasons: ['ocr-top-bottom-text'] },
  ]);
});

test('representative positive case can receive multiple semantic labels', async () => {
  const classifier = createSignalMediaClassifier({ name: 'signals' });
  const service = createMediaClassificationService({ classifiers: [classifier], now: () => '2026-09-19T12:00:00.000Z' });
  const result = await service.classify({ id: 'img-1', signals: { memeScore: 0.92, selfieScore: 0.81, documentScore: 0.1 } });
  assert.equal(result.status, 'OK');
  assert.deepEqual(result.labels.map((label) => label.category), ['MEME', 'SELFIE']);
  assert.equal(result.labels[0].provenance, 'signals');
});

test('representative negative case may receive zero labels without failure', async () => {
  const classifier = createSignalMediaClassifier();
  const service = createMediaClassificationService({ classifiers: [classifier] });
  const result = await service.classify({ id: 'img-2', signals: { memeScore: 0.2, selfieScore: 0.3, documentScore: 0.4 } });
  assert.equal(result.status, 'OK');
  assert.deepEqual(result.labels, []);
});

test('classifier failure does not corrupt prior media inventory identity and is explicit', async () => {
  const store = createMemoryMediaClassificationStore();
  const broken = { name: 'broken', async classify() { const error = new Error('model unavailable'); error.code = 'MODEL_UNAVAILABLE'; throw error; } };
  const service = createMediaClassificationService({ store, classifiers: [broken] });
  const result = await service.classify({ id: 'img-3', sourceUri: 'content://media/3' });
  assert.equal(result.status, 'FAILED');
  assert.deepEqual(result.labels, []);
  assert.equal(result.errors[0].code, 'MODEL_UNAVAILABLE');
  assert.deepEqual(await service.get('img-3'), result);
});

test('classifier unavailability is explicit and queryable result remains empty', async () => {
  const service = createMediaClassificationService({ classifiers: [] });
  const result = await service.classify({ id: 'img-4' });
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.errors[0].code, 'CLASSIFIER_UNAVAILABLE');
  assert.deepEqual(await service.queryByCategory('DOCUMENT'), []);
});

test('inventory can be queried by semantic category and minimum confidence', async () => {
  const classifier = createSignalMediaClassifier();
  const service = createMediaClassificationService({ classifiers: [classifier] });
  await service.classify({ id: 'a', signals: { documentScore: 0.95 } });
  await service.classify({ id: 'b', signals: { documentScore: 0.75 } });
  await service.classify({ id: 'c', signals: { selfieScore: 0.9 } });
  const documents = await service.queryByCategory('document', { minConfidence: 0.8 });
  assert.deepEqual(documents.map((row) => row.itemId), ['a']);
});

test('multiple classifier adapters keep best confidence per category and preserve provenance', async () => {
  const a = { name: 'ml-kit', async classify() { return { labels: [{ category: 'SELFIE', confidence: 0.72 }] }; } };
  const b = { name: 'mediapipe', async classify() { return { labels: [{ category: 'SELFIE', confidence: 0.88 }] }; } };
  const service = createMediaClassificationService({ classifiers: [a, b] });
  const result = await service.classify({ id: 'img-5' });
  assert.deepEqual(result.labels, [{ category: 'SELFIE', confidence: 0.88, provenance: 'mediapipe', reasons: [] }]);
});

test('classification capability remains read-only and replaceable', () => {
  const service = createMediaClassificationService({ classifiers: [createSignalMediaClassifier()] });
  let definition;
  const naia = { registerCapability(value) { definition = value; return { name: value.name, risk: value.tool.risk }; } };
  const [registered] = registerMediaClassificationCapabilities(naia, { service, resolveItem: async () => ({ id: 'x' }) });
  assert.deepEqual(registered, { name: 'media.classify', risk: 'READ_ONLY' });
  assert.equal(definition.tool.capability, 'media.classification');
  assert.equal(definition.rule.action({ id: 'media-1' }).requiresApproval, false);
});
