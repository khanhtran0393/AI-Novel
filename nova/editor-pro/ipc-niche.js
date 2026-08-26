// IPC cho Tìm Ngách (Niche Finder) — 6 module. Progress qua 'nova:nicheProgress'.
const N = require('./niche');
function registerEditorProNiche(ipcMain, opts = {}) {
  const chans = [];
  const on = (e) => (p, m) => { try { e.sender.send('nova:nicheProgress', { percent: p, message: m }); } catch (_) {} };
  const H = (ch, fn) => { try { ipcMain.removeHandler(ch); } catch (_) {} ipcMain.handle(ch, fn); chans.push(ch); };
  const wrap = (fn) => async (e, payload = {}) => {
    try { return await fn(e, payload); }
    catch (err) { return { ok: false, error: String(err && err.message || err).slice(0, 220) }; }
  };
  const seedOf = (p) => String((p && (p.seed || p.query || p.channel)) || '').trim();

  const opt = (p) => ({ fresh: !!p.fresh });
  H('nova:niche:attention', wrap((e, p) => { if (!seedOf(p)) return { ok: false, error: 'Nhập từ khoá ngách' }; return N.attentionMarkets(seedOf(p), on(e), opt(p)); }));
  // ── 4 ô mới của tab Nghiên cứu Ngách ──
  H('nova:niche:hot', wrap((e, p) => { if (!seedOf(p)) return { ok: false, error: 'Nhập từ khoá ngách' }; return N.hotTopics(seedOf(p), on(e), opt(p)); }));
  H('nova:niche:scorecard', wrap((e, p) => { const u = String(p.channel || p.url || '').trim(); if (!u) return { ok: false, error: 'Nhập kênh đối thủ' }; return N.channelScorecard(u, on(e), { ...opt(p), count: p.count }); }));
  H('nova:niche:similar', wrap((e, p) => { const u = String(p.channel || p.url || '').trim(); if (!u) return { ok: false, error: 'Nhập kênh gốc' }; return N.similarChannels(u, on(e), { ...opt(p), limit: p.limit }); }));
  H('nova:niche:bw', wrap((e, p) => N.bwScore(p, on(e))));
  return chans;
}
module.exports = { registerEditorProNiche };
