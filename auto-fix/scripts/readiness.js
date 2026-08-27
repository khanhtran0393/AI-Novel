'use strict';

const path = require('path');
const { inspectRepository } = require('../repository-adapter');
const { loadPolicy, policyPath } = require('../policy');
const { evaluateReadiness } = require('../gates');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const policy = loadPolicy(process.env.AUTO_FIX_POLICY || policyPath());
const repository = inspectRepository(root);
const report = evaluateReadiness({ policy, repository });
console.log(JSON.stringify({
  schemaVersion: report.schemaVersion,
  status: report.status,
  repository,
  gates: report.gates,
}, null, 2));
process.exitCode = report.status === 'PASS' ? 0 : 2;
