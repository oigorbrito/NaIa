import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const FORMAL_PROMOTION_POLICY_PATH = 'research/chassis/formal-promotion-policy.v1.json';
const POLICY_URL = new URL('../formal-promotion-policy.v1.json', import.meta.url);
const POLICY_TEXT = readFileSync(POLICY_URL, 'utf8');

export const FORMAL_PROMOTION_POLICY = Object.freeze(JSON.parse(POLICY_TEXT));
export const FORMAL_PROMOTION_POLICY_SHA256 = createHash('sha256').update(POLICY_TEXT).digest('hex');

export function formalPromotionPolicyProvenance() {
  return {
    path: FORMAL_PROMOTION_POLICY_PATH,
    schemaVersion: FORMAL_PROMOTION_POLICY.schemaVersion,
    status: FORMAL_PROMOTION_POLICY.status,
    sha256: FORMAL_PROMOTION_POLICY_SHA256
  };
}

export function formalPromotionPolicyProvenanceValid(value) {
  return Boolean(
    value &&
    value.path === FORMAL_PROMOTION_POLICY_PATH &&
    value.schemaVersion === FORMAL_PROMOTION_POLICY.schemaVersion &&
    value.status === FORMAL_PROMOTION_POLICY.status &&
    value.sha256 === FORMAL_PROMOTION_POLICY_SHA256
  );
}
