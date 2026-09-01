import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const FORMAL_PROMOTION_POLICY_PATH = 'research/chassis/formal-promotion-policy.v1.json';
const POLICY_URL = new URL('../formal-promotion-policy.v1.json', import.meta.url);
const POLICY_TEXT = readFileSync(POLICY_URL, 'utf8');

export const FORMAL_PROMOTION_POLICY = Object.freeze(JSON.parse(POLICY_TEXT));
export const FORMAL_PROMOTION_POLICY_SHA256 = createHash('sha256').update(POLICY_TEXT).digest('hex');

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function sha256Value(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

export function formalPromotionPolicyProvenance() {
  return {
    path: FORMAL_PROMOTION_POLICY_PATH,
    schemaVersion: FORMAL_PROMOTION_POLICY.schemaVersion,
    status: FORMAL_PROMOTION_POLICY.status,
    sha256: FORMAL_PROMOTION_POLICY_SHA256
  };
}

export function formalPromotionPolicyProvenanceStructurallyValid(value) {
  return Boolean(
    value &&
    value.path === FORMAL_PROMOTION_POLICY_PATH &&
    value.schemaVersion === 1 &&
    nonEmpty(value.status) &&
    sha256Value(value.sha256)
  );
}

export function formalPromotionPolicyProvenanceValid(value) {
  return Boolean(
    formalPromotionPolicyProvenanceStructurallyValid(value) &&
    value.schemaVersion === FORMAL_PROMOTION_POLICY.schemaVersion &&
    value.status === FORMAL_PROMOTION_POLICY.status &&
    value.sha256 === FORMAL_PROMOTION_POLICY_SHA256
  );
}
