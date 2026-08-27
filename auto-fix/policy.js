'use strict';

const fs = require('fs');
const path = require('path');

const REQUIRED_AUTHORITIES = [
  'readSource',
  'writeSource',
  'executeCommands',
  'createBranch',
  'commit',
  'build',
  'sign',
  'release',
  'rollout',
  'rollback',
];

const REQUIRED_GATES = [
  'requireReproduction',
  'requireRegression',
  'requireBuildVerification',
  'requireSecurityScan',
  'requireArtifactVerification',
  'highRiskRequiresHumanApproval',
];

const REQUIRED_HIGH_RISK_AREAS = [
  'authentication',
  'authorization',
  'encryption',
  'signing',
  'updater',
  'licensing',
  'security',
  'database',
  'native-process-boundary',
  'cookie-token-session',
];

function policyPath() {
  return path.join(__dirname, 'config', 'policy.json');
}

function loadPolicy(file = policyPath()) {
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

function missingKeys(object, keys) {
  return keys.filter((key) => !object || !Object.prototype.hasOwnProperty.call(object, key));
}

function validatePolicy(policy) {
  const errors = [];

  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    return ['policy must be a JSON object'];
  }

  if (policy.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (policy.mode !== 'observe-only') errors.push('mode must be observe-only');
  if (policy.runtimeEnabled !== false) errors.push('runtimeEnabled must be false');

  const missingAuthorities = missingKeys(policy.authorities, REQUIRED_AUTHORITIES);
  if (missingAuthorities.length) errors.push(`missing authorities: ${missingAuthorities.join(', ')}`);
  for (const authority of REQUIRED_AUTHORITIES) {
    if (policy.authorities && policy.authorities[authority] !== false) {
      errors.push(`authority must remain disabled: ${authority}`);
    }
  }

  const missingGates = missingKeys(policy.gates, REQUIRED_GATES);
  if (missingGates.length) errors.push(`missing gates: ${missingGates.join(', ')}`);
  for (const gate of REQUIRED_GATES) {
    if (policy.gates && policy.gates[gate] !== true) errors.push(`gate must be enabled: ${gate}`);
  }

  const missingRiskAreas = REQUIRED_HIGH_RISK_AREAS.filter(
    (area) => !Array.isArray(policy.highRiskAreas) || !policy.highRiskAreas.includes(area),
  );
  if (missingRiskAreas.length) errors.push(`missing high-risk areas: ${missingRiskAreas.join(', ')}`);

  if (!policy.limits || policy.limits.maxPatchFiles !== 0) errors.push('maxPatchFiles must be 0');
  if (!policy.limits || policy.limits.maxPatchLines !== 0) errors.push('maxPatchLines must be 0');
  if (!policy.limits || policy.limits.maxJobTokenBudget !== 0) errors.push('maxJobTokenBudget must be 0');
  if (!policy.limits || policy.limits.maxJobDurationSeconds !== 0) errors.push('maxJobDurationSeconds must be 0');
  if (!policy.limits || !Number.isInteger(policy.limits.maxAuditRecordBytes) || policy.limits.maxAuditRecordBytes < 1024) {
    errors.push('maxAuditRecordBytes must be an integer >= 1024');
  }
  if (!policy.limits || !Number.isInteger(policy.limits.maxEvidenceItems) || policy.limits.maxEvidenceItems < 1) {
    errors.push('maxEvidenceItems must be a positive integer');
  }
  if (!policy.limits || !Number.isInteger(policy.limits.maxEvidenceStringLength) || policy.limits.maxEvidenceStringLength < 64) {
    errors.push('maxEvidenceStringLength must be an integer >= 64');
  }
  if (!policy.boundaries || !Array.isArray(policy.boundaries.approvedRelativeRoots) || policy.boundaries.approvedRelativeRoots.length === 0) {
    errors.push('approvedRelativeRoots must be a non-empty array');
  }
  if (!policy.boundaries || !Array.isArray(policy.boundaries.deniedRelativeRoots)) {
    errors.push('deniedRelativeRoots must be an array');
  }
  if (!policy.boundaries || policy.boundaries.denySensitiveNames !== true) {
    errors.push('denySensitiveNames must be true');
  }
  if (!policy.audit || policy.audit.appendOnly !== true) errors.push('audit.appendOnly must be true');
  if (!policy.audit || policy.audit.redactSecrets !== true) errors.push('audit.redactSecrets must be true');

  return errors;
}

function authorization(policy, authority) {
  const errors = validatePolicy(policy);
  if (errors.length) {
    return { allowed: false, authority, reason: 'invalid-policy', errors };
  }
  if (!REQUIRED_AUTHORITIES.includes(authority)) {
    return { allowed: false, authority, reason: 'unknown-authority' };
  }
  return { allowed: false, authority, reason: 'deny-by-default' };
}

module.exports = {
  REQUIRED_AUTHORITIES,
  REQUIRED_GATES,
  REQUIRED_HIGH_RISK_AREAS,
  authorization,
  loadPolicy,
  policyPath,
  validatePolicy,
};
