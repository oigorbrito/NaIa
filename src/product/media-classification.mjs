function clone(value) { return structuredClone(value); }
const SUPPORTED_LABELS = new Set(['MEME', 'SELFIE', 'DOCUMENT']);

export function normalizeClassificationResult(result, { classifier = 'unknown' } = {}) {
  const labels = [];
  for (const item of result?.labels ?? []) {
    const category = String(item?.category ?? '').trim().toUpperCase();
    if (!SUPPORTED_LABELS.has(category)) continue;
    const confidence = Number(item?.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) continue;
    labels.push({
      category,
      confidence,
      provenance: item?.provenance ?? classifier,
      reasons: Array.isArray(item?.reasons) ? [...item.reasons] : [],
    });
  }
  labels.sort((a, b) => b.confidence - a.confidence || a.category.localeCompare(b.category));
  return labels;
}

export function createSignalMediaClassifier({ name = 'signal-classifier', thresholds = {} } = {}) {
  const memeThreshold = thresholds.meme ?? 0.7;
  const selfieThreshold = thresholds.selfie ?? 0.7;
  const documentThreshold = thresholds.document ?? 0.7;
  return {
    name,
    async classify(item) {
      const signals = item?.signals ?? {};
      const labels = [];
      const memeScore = Number(signals.memeScore ?? 0);
      const selfieScore = Number(signals.selfieScore ?? 0);
      const documentScore = Number(signals.documentScore ?? 0);
      if (Number.isFinite(memeScore) && memeScore >= memeThreshold) labels.push({ category: 'MEME', confidence: memeScore, reasons: ['meme-signal'] });
      if (Number.isFinite(selfieScore) && selfieScore >= selfieThreshold) labels.push({ category: 'SELFIE', confidence: selfieScore, reasons: ['selfie-signal'] });
      if (Number.isFinite(documentScore) && documentScore >= documentThreshold) labels.push({ category: 'DOCUMENT', confidence: documentScore, reasons: ['document-signal'] });
      return { labels };
    },
  };
}

export function createMemoryMediaClassificationStore() {
  const rows = new Map();
  return {
    async save(itemId, record) { rows.set(itemId, clone(record)); return clone(record); },
    async get(itemId) { const value = rows.get(itemId); return value ? clone(value) : null; },
    async queryByCategory(category, { minConfidence = 0 } = {}) {
      const normalized = String(category ?? '').trim().toUpperCase();
      return [...rows.entries()].filter(([, record]) =>
        record.labels.some((label) => label.category === normalized && label.confidence >= minConfidence)
      ).map(([itemId, record]) => ({ itemId, ...clone(record) }));
    },
  };
}

export function createMediaClassificationService({ store = createMemoryMediaClassificationStore(), classifiers = [], now = () => new Date().toISOString() } = {}) {
  const available = classifiers.filter((classifier) => classifier && typeof classifier.classify === 'function');

  return {
    async classify(item) {
      if (!item?.id) throw new Error('media item id is required');
      if (available.length === 0) {
        const record = { status: 'UNAVAILABLE', labels: [], errors: [{ code: 'CLASSIFIER_UNAVAILABLE' }], classifiedAt: now() };
        await store.save(item.id, record);
        return clone(record);
      }

      const labels = [];
      const errors = [];
      for (const classifier of available) {
        try {
          const result = await classifier.classify(clone(item));
          labels.push(...normalizeClassificationResult(result, { classifier: classifier.name ?? 'unnamed-classifier' }));
        } catch (error) {
          errors.push({ classifier: classifier.name ?? 'unnamed-classifier', code: error?.code ?? 'CLASSIFIER_ERROR', message: error?.message ?? String(error) });
        }
      }

      const byCategory = new Map();
      for (const label of labels) {
        const current = byCategory.get(label.category);
        if (!current || label.confidence > current.confidence) byCategory.set(label.category, label);
      }
      const record = {
        status: errors.length === available.length ? 'FAILED' : 'OK',
        labels: [...byCategory.values()].sort((a, b) => b.confidence - a.confidence || a.category.localeCompare(b.category)),
        errors,
        classifiedAt: now(),
      };
      await store.save(item.id, record);
      return clone(record);
    },

    async get(itemId) { return store.get(itemId); },
    async queryByCategory(category, options = {}) { return store.queryByCategory(category, options); },
  };
}

export function registerMediaClassificationCapabilities(naia, { service, resolveItem }) {
  if (!naia || typeof naia.registerCapability !== 'function') throw new Error('NaIA capability registration is required');
  if (!service || typeof resolveItem !== 'function') throw new Error('classification service and item resolver are required');
  return [
    naia.registerCapability({
      name: 'media.classify',
      tool: {
        risk: 'READ_ONLY',
        capability: 'media.classification',
        description: 'Classifies authorized media into semantic categories',
        async run(input) {
          const item = await resolveItem(input.itemId);
          if (!item) throw new Error('media item not found: ' + input.itemId);
          return service.classify(item);
        },
      },
      rule: {
        name: 'media-classify',
        match: ({ title }) => /classificar|classifique|classify/i.test(String(title ?? '')) && /m[ií]dia|foto|imagem|media|photo|image/i.test(String(title ?? '')),
        action: ({ id }) => ({ tool: 'media.classify', input: { itemId: id }, risk: 'READ_ONLY', requiresApproval: false }),
      },
    }),
  ];
}
