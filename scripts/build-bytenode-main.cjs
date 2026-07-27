/**
 * Compile main.js to V8 Bytecode (.jsc) for production packaging.
 * Node/Electron loads main.jsc via bytenode loader.
 */
'use strict';

const bytenode = require('bytenode');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function compileToBytecode(inputFile, outputFile) {
  if (!fs.existsSync(inputFile)) {
    console.warn(`[Bytenode] File not found: ${inputFile}`);
    return;
  }
  console.log(`[Bytenode] Compiling ${path.basename(inputFile)} -> ${path.basename(outputFile)}...`);
  try {
    bytenode.compileFile({
      filename: inputFile,
      output: outputFile,
      compileAsModule: true,
    });
    console.log(`[Bytenode] Successfully compiled ${path.basename(outputFile)} (${fs.statSync(outputFile).size} bytes)`);
  } catch (err) {
    console.error(`[Bytenode] Error compiling ${inputFile}:`, err.message);
  }
}

function main() {
  const mainJs = path.join(ROOT, 'main.js');
  const mainJsc = path.join(ROOT, 'main.jsc');

  compileToBytecode(mainJs, mainJsc);
}

main();
