'use strict';

const { loadPolicy, policyPath, validatePolicy } = require('../policy');

const file = process.argv[2] || policyPath();
let policy;
try {
  policy = loadPolicy(file);
} catch (error) {
  console.error(`POLICY: FAIL (${file})`);
  console.error(error.message);
  process.exitCode = 1;
  return;
}

const errors = validatePolicy(policy);
if (errors.length) {
  console.error(`POLICY: FAIL (${file})`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
  return;
}

console.log(`POLICY: PASS (${file})`);
console.log('MODE: observe-only');
console.log('RUNTIME: disabled');
console.log('AUTHORITIES: deny-by-default');
