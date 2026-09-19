import assert from 'node:assert/strict';
import test from 'node:test';
import {
  billDraftFromDocument,
  createDocumentExtractionService,
  createFixtureDocumentExtractor,
  createMemoryDocumentStore,
  createRuleBasedDocumentExtractor,
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

test('rule-based extractor captures only observable bill fields from text', async () => {
  const store = createMemoryDocumentStore();
  const service = createDocumentExtractionService({ store, extractor: createRuleBasedDocumentExtractor(), idFactory: () => 'doc-1' });
  const result = await service.ingestArtifact({
    sourceType: 'device', sourceItemId: 'file-1', sourceUri: 'file:///bill.txt',
    text: 'Fatura 99881\nVencimento: 25/09/2026\nValor: R$ 123,45\nReferência: REF-7788',
    metadata: { issuer: 'Internet Co' },
  });
  assert.equal(result.duplicate, false);
  assert.equal(result.document.documentClass, 'bill');
  assert.equal(result.document.amount, 123.45);
  assert.equal(result.document.dueDate, '2026-09-25');
  assert.equal(result.document.paymentReference, 'REF-7788');
  assert.equal(result.document.issuer, 'Internet Co');
  assert.equal(result.document.sourceItemId, 'file-1');
  assert.ok(result.document.extractionConfidence > 0);
});

test('rule-based extractor captures payment receipt amount/date/reference without inferring settlement beyond text', async () => {
  const store = createMemoryDocumentStore();
  const service = createDocumentExtractionService({ store, extractor: createRuleBasedDocumentExtractor(), idFactory: () => 'receipt-1' });
  const result = await service.ingestArtifact({
    sourceType: 'whatsapp', sourceItemId: 'media-1',
    text: 'Comprovante de pagamento\nPago em: 26/09/2026\nR$ 123,45\nAutenticação: REF-7788',
  });
  assert.equal(result.document.documentClass, 'payment_receipt');
  assert.equal(result.document.paidAmount, 123.45);
  assert.equal(result.document.paymentDate, '2026-09-26');
  assert.equal(result.document.paymentReference, 'REF-7788');
});

test('missing OCR/text degrades to unknown document with zero confidence', async () => {
  const service = createDocumentExtractionService({ extractor: createRuleBasedDocumentExtractor(), idFactory: () => 'unknown-1' });
  const result = await service.ingestArtifact({ sourceType: 'photos', sourceItemId: 'photo-1', text: '' });
  assert.equal(result.document.documentClass, 'unknown_document');
  assert.equal(result.document.extractionConfidence, 0);
  assert.equal(result.document.amount, null);
});

test('document extraction adapter failure remains explicit and retryable', async () => {
  const service = createDocumentExtractionService({
    extractor: createFixtureDocumentExtractor({ fail: { code: 'OCR_TIMEOUT', message: 'timeout', retryable: true } }),
  });
  await assert.rejects(
    service.ingestArtifact({ sourceType: 'device', sourceItemId: 'f1', text: 'x' }),
    (error) => error.code === 'OCR_TIMEOUT' && error.retryable === true,
  );
});

test('reprocessing same source artifact skips second extraction and logical document creation', async () => {
  let calls = 0;
  const extractor = createFixtureDocumentExtractor({ result: () => { calls += 1; return { documentClass:'bill', amount:50, extractionConfidence:0.8 }; } });
  const service = createDocumentExtractionService({ store:createMemoryDocumentStore(), extractor, idFactory:()=> 'doc-1' });
  const first = await service.ingestArtifact({ sourceType:'drive', sourceItemId:'same', text:'first' });
  const second = await service.ingestArtifact({ sourceType:'drive', sourceItemId:'same', text:'changed' });
  assert.equal(first.duplicate,false);
  assert.equal(second.duplicate,true);
  assert.equal(calls,1);
});

test('bill without any receipt remains explicitly UNMATCHED_BILL', () => {
  const result = reconcileDocuments([{ id:'b1', documentClass:'bill', amount:100, dueDate:'2026-09-20', issuer:'Power Co' }]);
  assert.deepEqual(result, [{ state:'UNMATCHED_BILL', billId:'b1', receiptId:null, confidence:0, reasons:[], conflicts:[] }]);
});
