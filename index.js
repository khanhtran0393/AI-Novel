/**
 * AI Novel Entry Loader
 * In production/packaged mode with main.jsc present, loads V8 Bytecode via bytenode.
 * In dev mode, loads plain main.js for fast debugging.
 */
'use strict';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const jscPath = path.join(__dirname, 'main.jsc');
const isPackaged = app.isPackaged;

if (isPackaged && fs.existsSync(jscPath)) {
  try {
    require('bytenode');
    require(jscPath);
  } catch (err) {
    console.error('[Security] Failed to load main.jsc bytecode, falling back to main.js:', err);
    require('./main.js');
  }
} else {
  require('./main.js');
}
