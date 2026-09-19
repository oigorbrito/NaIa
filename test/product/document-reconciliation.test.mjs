import assert from 'node:assert/strict';
import test from 'node:test';
import {
  billDraftFromDocument,
  createMemoryDocumentStore,
  ingestDocument,
  reconcileDocuments,
  scoreBillReceipt,
} from '../../src/product/document-reconciliation.mjs';

test('exact identifier + amount match is deterministic and evidence-backed', () => {
  const bill = { id: 'b1', documentClass: 'bill', amount: 250, dueDate: '2026-09-20', payee: 'Energia SA', paymentReference: 'ABC-123' };
  const receipt = { id: 'r1', documentClass: 'payment_receipt', paidAmount: 250, paymentDate: '2026-09-20', payee: 'Energia SA', paymentReference: 'ABC-123' };
  const result = reconcileDocuments([bill, receipt]);
  assert.equal(result[0].state, 'MATCHED');
  assert.equal(result[0].receiptId, 'r1');
  assert.ok(result[0].reasons.includes('matching-paymentReference'));
  assert.ok(result[0].reasons.includes('matching-amount'));
});

test('fuzzy match exposes reasons and confidence instead of claiming certainty', () => {
  const bill = { id: 'b1', documentClass: 'invoice', amount: 100, dueDate: '2026-09-20', issuer: 'Internet Ltda' };
  const receipt = { id: 'r1', documentClass: 'bank_receipt', paidAmount: 100, paymentDate: '2026-09-22', issuer: 'Internet Ltda' };
  const result = reconcileDocuments([bill, receipt]);
  assert.equal(result[0].state, 'PROBABLE_MATCH');
  assert.ok(result[0].confidence >= 0.35);
  assert.ok(result[0].reasons.includes('matching-amount'));
  assert.ok(result[0].reasons.includes('matching-party'));
});

test('amount mismatch prevents weak evidence from becoming a false paid match', () => {
  const bill = { id: 'b1', documentClass: 'bill', amount: 300, dueDate: '2026-09-20', issuer: 'Water Co' };
  const receipt = { id: 'r1', documentClass: 'payment_receipt', paidAmount: 80, paymentDate: '2026-09-20', issuer: 'Water Co' };
  const scored = scoreBillReceipt(bill, receipt);
  assert.ok(scored.conflicts.includes('amount-mismatch'));
  const result = reconcileDocuments([bill, receipt]);
  assert.equal(result[0].state, 'UNMATCHED_BILL');
});

test('two similarly plausible receipts produce AMBIGUOUS instead of arbitrary choice', () => {
  const bill = { id: 'b1', documentClass: 'bill', amount: 50, dueDate: '2026-09-20', issuer: 'Phone Co' };
  const r1 = { id: 'r1', documentClass: 'payment_receipt', paidAmount: 50, paymentDate: '2026-09-20', issuer: 'Phone Co' };
  const r2 = { id: 'r2', documentClass: 'payment_receipt', paidAmount: 50, paymentDate: '2026-09-21', issuer: 'Phone Co' };
  const [result] = reconcileDocuments([bill, r1, r2]);
  assert.equal(result.state, 'AMBIGUOUS');
  assert.equal(result.candidates.length, 2);
});

test('missing extraction data degrades to explicit unmatched uncertainty', () => {
  const bill = { id: 'b1', documentClass: 'bill', amount: null, dueDate: null };
  const receipt = { id: 'r1', documentClass: 'payment_receipt', paidAmount: null, paymentDate: null };
  const result = reconcileDocuments([bill, receipt]);
  assert.equal(result[0].state, 'UNMATCHED_BILL');
  assert.equal(result[0].confidence, 0);
  assert.ok(result.some((entry) => entry.state === 'UNMATCHED_RECEIPT'));
});

test('source artifact ingestion is idempotent and preserves provenance', async () => {
  const store = createMemoryDocumentStore();
  const input = {
    id: 'doc-1', sourceType: 'google_drive', sourceItemId: 'drive-123', sourceUri: 'drive://drive-123',
    documentClass: 'bill', issuer: 'Power Co', dueDate: '2026-09-30', amount: 90, extractionSource: 'fixture-parser',
  };
  const first = await ingestDocument(store, input);
  const second = await ingestDocument(store, { ...input, id: 'doc-2' });
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.document.id, 'doc-1');
  assert.equal(second.document.sourceUri, 'drive://drive-123');
});

test('duplicate receipt artifacts do not create duplicate logical receipt documents', async () => {
  const store = createMemoryDocumentStore();
  const receipt = { id: 'r1', sourceType: 'whatsapp', sourceItemId: 'msg-media-1', documentClass: 'payment_receipt', paidAmount: 40 };
  await ingestDocument(store, receipt);
  await ingestDocument(store, { ...receipt, id: 'r2' });
  assert.equal((await store.list()).length, 1);
});

test('bill document can create a provenance-preserving draft for #66 without auto-payment semantics', () => {
  const draft = billDraftFromDocument({
    id: 'b1', documentClass: 'bill', issuer: 'Condo', dueDate: '2026-09-25', amount: 500,
    sourceType: 'device', sourceItemId: 'file-7', sourceUri: 'file:///docs/bill.pdf',
  });
  assert.deepEqual(draft, {
    name: 'Condo', dueDate: '2026-09-25', amount: 500, currency: 'BRL',
    source: { documentId: 'b1', sourceType: 'device', sourceItemId: 'file-7', sourceUri: 'file:///docs/bill.pdf' },
  });
});
