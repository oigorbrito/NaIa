# ECE Document Corpus Contract V1

Status: SPECIFIED_NOT_POPULATED

Purpose: define the minimum versioned corpus structure needed to make `ECE-DOC-001` and `ECE-REC-001` repeatable and reviewable without prescribing a universal corpus size, candidate set, model family, or ranking metric.

This document is a methodological derivation from the existing NaIA empirical-harness requirements for input identity, provenance, claim-scoped evidence, comparability, and raw-artifact traceability. It is not product behavior and does not create experimental evidence by itself.

## 1. Corpus identity

Every executable corpus release MUST have a stable identity containing at least:

```text
corpusId
corpusVersion
manifestRevision
caseCount
documentCount
contentHash or per-item hashes
annotationRevision
```

A change to a source artifact, expected annotation, or case relationship creates a new corpus identity or annotation revision. Results from different corpus identities MUST NOT be silently aggregated as one experiment series.

## 2. Source-document record

Each document entry MUST record:

```text
documentId
sourceType
mediaType
contentHash
sourceProvenance
expectedDocumentClass
annotationStatus
```

Optional fields MAY be included only when relevant to the declared claim, for example:

```text
language
pageCount
imageDimensions
qualityCondition
syntheticOrReal
redactionStatus
```

No optional field is methodologically required unless the claim or interpretation depends on it.

`sourceProvenance` MUST be sufficient to distinguish, where applicable, a document originating from a controlled fixture, public sample, user-authorized source, generated fixture, or transformed derivative.

Sensitive personal source material MUST NOT be committed merely to satisfy this corpus contract. A reproducible experiment may instead use appropriately licensed, consented, redacted, or generated fixtures when they preserve the claim-relevant semantics.

## 3. Extraction annotation for ECE-DOC-001

For each document evaluated for structured extraction, the corpus manifest MUST identify the expected fields that are actually observable in the source artifact.

The initial NaIA document domain MAY include these fields when present:

```text
documentClass
issuerOrPayee
documentNumber
customerOrAccountReference
dueDate
amount
currency
paymentDate
paidAmount
paymentMethod
barcodeOrPaymentReference
pixReference
```

The corpus MUST distinguish at least:

```text
EXPECTED_VALUE
EXPECTED_ABSENT
NOT_ANNOTATED
NOT_APPLICABLE
```

`NOT_ANNOTATED` MUST NOT be interpreted as an extraction failure or success.

A field normalization rule MUST be versioned before execution when equivalent surface representations can occur, for example date formatting, decimal separators, currency formatting, whitespace, punctuation, or normalized identifiers.

## 4. Reconciliation-case record for ECE-REC-001

Each reconciliation case MUST have a stable `caseId` and reference one or more corpus documents by `documentId`.

Minimum case record:

```text
caseId
inputDocumentIds
expectedState
groundTruthBasis
allowedEvidenceFields
annotationRevision
```

Expected reconciliation states currently admitted by the product concept are:

```text
MATCHED
PROBABLE_MATCH
UNMATCHED_BILL
UNMATCHED_RECEIPT
AMBIGUOUS
```

An experiment MAY use only a subset if its claim is explicitly narrower. It MUST NOT claim discrimination of a state absent from the evaluated cases.

`groundTruthBasis` records why the expected state was assigned, for example shared payment reference, matching amount and identifier, conflicting amount, duplicate candidate receipts, or absence of supporting receipt. It is annotation provenance, not candidate output.

## 5. Discriminating cases

The corpus SHOULD include cases that can distinguish the specific behavior claimed by the evaluation. For a reconciliation claim this can include, when relevant:

- an exact bill/receipt pair with a shared strong identifier;
- compatible amount/date/payee with weaker identifiers;
- amount conflict;
- identifier conflict;
- more than one plausible receipt;
- bill with no receipt;
- receipt with no bill;
- duplicated source artifact representing the same logical document.

This list is not a universal completeness requirement. Each included case class MUST be justified by the claim it is intended to discriminate.

## 6. Transformations and derivatives

If a source document is converted, rendered, OCR-preprocessed, cropped, redacted, compressed, or otherwise transformed before candidate evaluation, record:

```text
sourceDocumentId
derivativeDocumentId
transformationProcedure
transformationToolIdentity
transformationParameters
resultHash
```

A derivative is not silently interchangeable with its source when the transformation can affect the evaluated property.

## 7. Corpus split and sampling

This contract does not require training/test splits, random sampling, stratification, or a minimum case count universally.

If a study claim depends on generalization beyond the fixed corpus, candidate tuning, sampling, or statistical inference, the corresponding design and sampling procedure MUST be declared separately before execution.

A fixed conformance-style evaluation may instead declare that its conclusion is limited to the versioned corpus.

## 8. Candidate isolation

Candidate-specific prompts, parsers, adapters, OCR preprocessing, or schemas MUST be recorded as part of candidate configuration.

A candidate MAY require a provider-specific transport adapter, but the semantic input and expected output meaning MUST remain equivalent for comparison. If candidate-specific adaptation materially changes what is being asked, the comparison layer is `INCOMPARABLE` unless equivalence is justified.

## 9. Privacy and data handling

Corpus provenance MUST identify whether source artifacts are public/licensed, generated, redacted, or user-authorized.

Secrets, OAuth credentials, access tokens, private cloud URLs, and unrelated personal identifiers MUST NOT be stored in the corpus manifest or result evidence.

## 10. Readiness checklist

A corpus is ready for a declared ECE series only when:

```text
[ ] corpus identity is stable and versioned
[ ] every input has a stable documentId and content identity
[ ] expected annotations required by the claim are complete
[ ] NOT_ANNOTATED is distinguishable from EXPECTED_ABSENT
[ ] normalization rules required by the claim are versioned
[ ] reconciliation relationships, if used, have stable caseIds
[ ] ground-truth basis is reviewable
[ ] transformations are attributable
[ ] source provenance/privacy status is recorded
[ ] no candidate result has been used to retroactively define expected truth
```

Completing this checklist establishes corpus readiness only. It does not establish candidate correctness, comparative superiority, or independent reproduction.
