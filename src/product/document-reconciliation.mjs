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

export function reconcileDocuments(documents, { probableThreshold = 0.55, exactThreshold = 0.85, ambiguityDelta = 0.05 } = {}) {
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
