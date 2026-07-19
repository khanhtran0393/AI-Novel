(function installFlowTabGuard(globalScope) {
  async function waitForExistingFlowTabs(queryTabs, sleep, options = {}) {
    const attempts = Math.max(1, Number(options.attempts) || 8);
    const intervalMs = Math.max(0, Number(options.intervalMs) || 250);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const tabs = await queryTabs();
      if (Array.isArray(tabs) && tabs.length > 0) return tabs;
      if (attempt + 1 < attempts) await sleep(intervalMs);
    }
    return [];
  }

  globalScope.AINOVEL_FLOW_TAB_GUARD = { waitForExistingFlowTabs };
})(globalThis);
