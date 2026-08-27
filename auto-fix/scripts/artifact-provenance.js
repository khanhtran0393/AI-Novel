'use strict';

const path = require('path');
const { generateProvenance } = require('../artifact-provenance');

const artifactRoot = process.argv[2];
const outputPath = process.argv[3];
const repositoryRoot = process.argv[4] || path.join(__dirname, '..', '..');

if (!artifactRoot || !outputPath) {
  console.error('usage: node auto-fix/scripts/artifact-provenance.js <artifact-root> <output-json> [repository-root]');
  process.exitCode = 2;
} else {
  try {
    const evidence = generateProvenance({ artifactRoot, outputPath, repositoryRoot });
    console.log(`ARTIFACT PROVENANCE: PASS (${evidence.artifacts.length} files)`);
  } catch (error) {
    console.error(`ARTIFACT PROVENANCE: FAIL (${error.message})`);
    process.exitCode = 1;
  }
}
