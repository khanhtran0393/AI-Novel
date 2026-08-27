'use strict';

const { authorization } = require('./policy');

const TOOLS = Object.freeze({
  inspectRepository: Object.freeze({ name: 'inspectRepository', purpose: 'read-only repository metadata', authority: 'readSource', sideEffects: false }),
  evaluateReadiness: Object.freeze({ name: 'evaluateReadiness', purpose: 'evaluate gates from supplied evidence', authority: 'readSource', sideEffects: false }),
});

function listTools() { return Object.values(TOOLS); }
function getTool(name) { return TOOLS[name] || null; }
function authorizeTool(policy, name) {
  const tool = getTool(name);
  if (!tool) return { allowed: false, reason: 'unknown-tool', tool: name };
  const decision = authorization(policy, tool.authority);
  return { ...decision, tool: name };
}

module.exports = { authorizeTool, getTool, listTools };
