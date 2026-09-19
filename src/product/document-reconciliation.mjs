import { randomUUID } from 'node:crypto';

const CLASSES = new Set(['bill', 'invoice', 'payment_receipt', 'bank_receipt', 'unknown_document']);

function clone(value) { return structuredClone(value); }
function norm(value) { return String(value ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' '); }
function round(value, digits = 4) { return Number(Number(value ?? 0).toFixed(digits)); }
function absDays(a, b) {
  if (!a || !b) return null;
  const x = new Date(a); const y = new Date(b);
  if (Number.isNaN(x.getTime()) || Number.isNaN(y.getTime())) return null;
  return Math.abs(x - y) / 86400000;
}

export function normalizeDocument(input, { idFactory = randomUUID } = {}) {
  const documentClass = CLASSES.has(input?.documentClass) ? input.documentClass : 'unknown_document';
  const amount = input?.amount == null ? null : Number(input.amount);
  const paidAmount = input?.paidAmount == null ? null : Number(input.paidAmount);
  return {
    id: input?.id ?? idFactory(),
    sourceItemId: String(input?.sourceItemId ?? '').trim() || null,
    sourceType: input?.sourceType ?? null,
    sourceUri: input?.sourceUri ?? null,
    documentClass,
    issuer: input?.issuer ?? null,
    payee: input?.payee ?? null,
    accountRef: input?.accountRef ?? null,
    documentNumber: input?.documentNumber ?? null,
    dueDate: input?.dueDate ?? null,
    amount: Number.isFinite(amount) ? amount : null,
    paymentDate: input?.paymentDate ?? null,
    paidAmount: Number.isFinite(paidAmount) ? paidAmount : null,
    barcode: input?.barcode ?? null,
    pixReference: input?.pixReference ?? null,
    paymentReference: input?.paymentReference ?? null,
    extractionConfidence: input?.extractionConfidence ?? null,
    extractionSource: input?.extractionSource ?? null,
    extractedFields: clone(input?.extractedFields ?? {}),
  };
}

export function createMemoryDocumentStore() {
  const docs = new Map();
  const sourceIndex = new Map();
  return {
    async save(document) {
      docs.set(document.id, clone(document));
      if (document.sourceItemId) sourceIndex.set(document.sourceType + ':' + document.sourceItemId, document.id);
      return clone(document);
    },
    async get(id) { const value = docs.get(id); return value ? clone(value) : null; },
    async list() { return [...docs.values()].map(clone); },
    async findBySource(sourceType, sourceItemId) {
      const id = sourceIndex.get(sourceType + ':' + sourceItemId);
      return id ? clone(docs.get(id)) : null;
    },
  };
}

export async function ingestDocument(store, input, options = {}) {
  if (!store?.save) throw new Error('document store is required');
  if (input?.sourceType && input?.sourceItemId && store.findBySource) {
    const existing = await store.findBySource(input.sourceType, input.sourceItemId);
    if (existing) return { document: existing, duplicate: true };
  }
  const document = normalizeDocument(input, options);
  await store.save(document);
  return { document, duplicate: false };
}

function matchingReference(bill, receipt) {
  const pairs = [
    ['barcode', bill.barcode, receipt.barcode],
    ['pixReference', bill.pixReference, receipt.pixReference],
    ['paymentReference', bill.paymentReference, receipt.paymentReference],
    ['documentNumber', bill.documentNumber, receipt.documentNumber],
    ['accountRef', bill.accountRef, receipt.accountRef],
  ];
  for (const [field, left, right] of pairs) {
    if (left && right && norm(left) === norm(right)) return field;
  }
  return null;
}

export function scoreBillReceipt(bill, receipt) {
  const reasons = [];
  const conflicts = [];
  let score = 0;

  const ref = matchingReference(bill, receipt);
  if (ref) { score += 0.6; reasons.push('matching-' + ref); }

  const billAmount = bill.amount;
  const receiptAmount = receipt.paidAmount ?? receipt.amount;
  if (billAmount != null && receiptAmount != null) {
    const delta = Math.abs(billAmount - receiptAmount);
    if (delta <= 0.01) { score += 0.22; reasons.push('matching-amount'); }
    else if (delta <= Math.max(1, Math.abs(billAmount) * 0.02)) { score += 0.12; reasons.push('near-amount'); }
    else conflicts.push('amount-mismatch');
  }

  const billParty = bill.payee ?? bill.issuer;
  const receiptParty = receipt.payee ?? receipt.issuer;
  if (billParty && receiptParty) {
    if (norm(billParty) === norm(receiptParty)) { score += 0.12; reasons.push('matching-party'); }
    else conflicts.push('party-mismatch');
  }

  const days = absDays(bill.dueDate, receipt.paymentDate);
  if (days != null) {
    if (days <= 3) { score += 0.06; reasons.push('payment-date-near-due-date'); }
    else if (days <= 14) { score += 0.03; reasons.push('payment-date-plausible'); }
  }

  if (!ref && conflicts.includes('amount-mismatch')) score = Math.min(score, 0.39);
  if (ref && conflicts.includes('amount-mismatch')) score = Math.min(score, 0.69);

  return { score: round(Math.max(0, Math.min(1, score))), reasons, conflicts };
}

function isBill(document) { return document.documentClass === 'bill' || document.documentClass === 'invoice'; }
function isReceipt(document) { return document.documentClass === 'payment_receipt' || document.documentClass === 'bank_receipt'; }

export function reconcileDocuments(documents, { probableThreshold = 0.35, exactThreshold = 0.85, ambiguityDelta = 0.05 } = {}) {
  const bills = documents.filter(isBill);
  const receipts = documents.filter(isReceipt);
  const results = [];

  for (const bill of bills) {
    const candidates = receipts.map((receipt) => ({ receipt, ...scoreBillReceipt(bill, receipt) }))
      .sort((a, b) => b.score - a.score || a.receipt.id.localeCompare(b.receipt.id));
    const best = candidates[0];
    const second = candidates[1];
    if (!best || best.score < probableThreshold) {
      results.push({ state: 'UNMATCHED_BILL', billId: bill.id, receiptId: null, confidence: best?.score ?? 0, reasons: best?.reasons ?? [], conflicts: best?.conflicts ?? [] });
      continue;
    }
    if (second && second.score >= probableThreshold && Math.abs(best.score - second.score) <= ambiguityDelta) {
      results.push({
        state: 'AMBIGUOUS', billId: bill.id, receiptId: null, confidence: best.score,
        candidates: candidates.filter((candidate) => candidate.score >= probableThreshold).map((candidate) => ({ receiptId: candidate.receipt.id, confidence: candidate.score, reasons: candidate.reasons, conflicts: candidate.conflicts })),
      });
      continue;
    }
    results.push({
      state: best.score >= exactThreshold ? 'MATCHED' : 'PROBABLE_MATCH',
      billId: bill.id, receiptId: best.receipt.id, confidence: best.score, reasons: best.reasons, conflicts: best.conflicts,
    });
  }

  const linkedReceiptIds = new Set(results.flatMap((result) => [result.receiptId, ...(result.candidates ?? []).map((candidate) => candidate.receiptId)]).filter(Boolean));
  for (const receipt of receipts) {
    if (!linkedReceiptIds.has(receipt.id)) results.push({ state: 'UNMATCHED_RECEIPT', billId: null, receiptId: receipt.id, confidence: 0, reasons: [], conflicts: [] });
  }
  return results;
}

export function billDraftFromDocument(document) {
  if (!isBill(document)) throw new Error('document is not a bill/invoice');
  return {
    name: document.payee ?? document.issuer ?? document.documentNumber ?? 'Imported bill',
    dueDate: document.dueDate,
    amount: document.amount,
    currency: 'BRL',
    source: {
      documentId: document.id,
      sourceType: document.sourceType,
      sourceItemId: document.sourceItemId,
      sourceUri: document.sourceUri,
    },
  };
}

function parseMoney(text) {
  const patterns = [
    /(?:r\$|brl)\s*([0-9.]+,[0-9]{2})/i,
    /(?:total|valor|amount)\s*[:=-]?\s*(?:r\$|brl)?\s*([0-9.,]+)/i,
  ];
  for (const pattern of patterns) {
    const match = String(text ?? '').match(pattern);
    if (!match) continue;
    const raw = match[1].replace(/\./g, '').replace(',', '.');
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function parseDateField(text, labels) {
  const source = String(text ?? '');
  for (const label of labels) {
    const pattern = new RegExp(`${label}\\s*[:=-]?\\s*(\\d{1,2})[\\/.-](\\d{1,2})[\\/.-](\\d{2,4})`, 'i');
    const match = source.match(pattern);
    if (!match) continue;
    const year = match[3].length === 2 ? Number(`20${match[3]}`) : Number(match[3]);
    const month = Number(match[2]); const day = Number(match[1]);
    const date = new Date(Date.UTC(year, month - 1, day, 12));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) return date.toISOString().slice(0, 10);
  }
  return null;
}

function classifyText(text) {
  const value = norm(text);
  if (/comprovante|receipt|pagamento efetuado|payment receipt|transacao concluida/.test(value)) return 'payment_receipt';
  if (/extrato bancario|bank receipt/.test(value)) return 'bank_receipt';
  if (/nota fiscal|invoice/.test(value)) return 'invoice';
  if (/boleto|fatura|conta a pagar|bill/.test(value)) return 'bill';
  return 'unknown_document';
}

export function createRuleBasedDocumentExtractor({ name = 'rule-based-document-extractor' } = {}) {
  return {
    name,
    async extract({ text = '', metadata = {} } = {}) {
      const source = String(text ?? '');
      const documentClass = metadata.documentClass ?? classifyText(source);
      const amount = metadata.amount ?? parseMoney(source);
      const paidAmount = metadata.paidAmount ?? (documentClass === 'payment_receipt' || documentClass === 'bank_receipt' ? amount : null);
      const dueDate = metadata.dueDate ?? parseDateField(source, ['vencimento', 'vence em', 'due date']);
      const paymentDate = metadata.paymentDate ?? parseDateField(source, ['pagamento', 'pago em', 'payment date', 'data da transacao']);
      const barcode = metadata.barcode ?? (source.match(/\b\d{44,48}\b/)?.[0] ?? null);
      const pixReference = metadata.pixReference ?? (source.match(/(?:txid|pix)\s*[:=-]?\s*([A-Za-z0-9._-]{6,})/i)?.[1] ?? null);
      const paymentReference = metadata.paymentReference ?? (source.match(/(?:refer[eê]ncia|reference|autentica[cç][aã]o)\s*[:=-]?\s*([A-Za-z0-9._-]{4,})/i)?.[1] ?? null);
      const documentNumber = metadata.documentNumber ?? (source.match(/(?:documento|fatura|invoice|nota)\s*(?:n[oº°.]*)?\s*[:=-]?\s*([A-Za-z0-9._/-]{3,})/i)?.[1] ?? null);
      const issuer = metadata.issuer ?? null;
      const payee = metadata.payee ?? null;
      const accountRef = metadata.accountRef ?? null;
      const observed = { documentClass, amount, paidAmount, dueDate, paymentDate, barcode, pixReference, paymentReference, documentNumber, issuer, payee, accountRef };
      const observedCount = Object.entries(observed).filter(([key, value]) => key !== 'documentClass' && value !== null && value !== undefined).length;
      return {
        ...observed,
        extractionConfidence: documentClass === 'unknown_document' && observedCount === 0 ? 0 : Math.min(0.95, 0.35 + observedCount * 0.1),
        extractionSource: name,
        extractedFields: Object.fromEntries(Object.entries(observed).filter(([, value]) => value !== null && value !== undefined)),
      };
    },
  };
}

export function createFixtureDocumentExtractor({ name = 'fixture-document-extractor', result = {}, fail = null } = {}) {
  return {
    name,
    async extract(input) {
      if (fail) { const error = new Error(fail.message ?? 'document extraction failed'); error.code = fail.code ?? 'EXTRACTION_FAILED'; error.retryable = Boolean(fail.retryable); throw error; }
      return clone(typeof result === 'function' ? await result(clone(input)) : result);
    },
  };
}

export function createDocumentExtractionService({ store = createMemoryDocumentStore(), extractor, idFactory = randomUUID } = {}) {
  if (!extractor || typeof extractor.extract !== 'function') throw new Error('document extractor is required');
  return {
    async ingestArtifact({ sourceType, sourceItemId, sourceUri = null, text = '', metadata = {} }) {
      if (!sourceType || !sourceItemId) throw new Error('sourceType and sourceItemId are required');
      const existing = await store.findBySource?.(sourceType, sourceItemId);
      if (existing) return { document: existing, duplicate: true, extraction: null };
      let extraction;
      try { extraction = await extractor.extract({ text, metadata: clone(metadata), sourceType, sourceItemId }); }
      catch (error) {
        const wrapped = new Error(error?.message ?? 'document extraction failed');
        wrapped.code = error?.code ?? 'EXTRACTION_FAILED';
        wrapped.retryable = Boolean(error?.retryable);
        throw wrapped;
      }
      const normalized = {
        ...clone(extraction ?? {}),
        sourceType, sourceItemId, sourceUri,
        extractionSource: extraction?.extractionSource ?? extractor.name ?? 'document-extractor',
      };
      const ingested = await ingestDocument(store, normalized, { idFactory });
      return { ...ingested, extraction: clone(extraction ?? null) };
    },
    async list() { return store.list(); },
    async get(id) { return store.get(id); },
  };
}
