// YouTube Data API v3 enrichment — dùng KEY CỦA NOVA (localStorage 'yt_api_key'),
// KHÔNG dùng key hardcode của Fractal. Chỉ enrich ID đã tìm (videos.list = 1 unit/50 vid),
// không search.list (100 unit) → tiết kiệm quota.
let _nk = null; try { _nk = require('./nova-keys'); } catch (_) {}
const YT = 'https://www.googleapis.com/youtube/v3/';

async function ytKey() {
  if (process.env.YT_API_KEY) return process.env.YT_API_KEY.trim();   // cho test CLI
  if (_nk) { try { const k = await _nk.novaLocalStorage('yt_api_key'); if (k) return k; } catch (_) {} }
  return null;
}
async function api(path, params, key) {
  const qs = new URLSearchParams({ ...params, key }).toString();
  const r = await fetch(YT + path + '?' + qs);
  if (!r.ok) throw new Error('YT API ' + r.status + ' ' + (await r.text()).slice(0, 120));
  return r.json();
}
function isoToSec(iso) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '') || [];
  return (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0));
}
function daysSince(iso) { if (!iso) return null; const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); return d >= 0 ? d : null; }

// ids: mảng videoId → map id → {views,likes,comments,dur,date,days,channelId,channel,subs, engRate, viewPerSub, demand, vel}
async function enrich(ids) {
  const key = await ytKey();
  if (!key || !ids.length) return { key: !!key, map: {} };
  const map = {};
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50).filter(Boolean);
    if (!chunk.length) continue;
    const d = await api('videos', { part: 'statistics,contentDetails,snippet', id: chunk.join(',') }, key);
    for (const it of (d.items || [])) {
      const st = it.statistics || {}, sn = it.snippet || {}, cd = it.contentDetails || {};
      const views = +st.viewCount || 0, likes = +st.likeCount || 0, comments = +st.commentCount || 0;
      const days = daysSince(sn.publishedAt);
      map[it.id] = {
        views, likes, comments, dur: isoToSec(cd.duration), date: sn.publishedAt || '', days,
        channelId: sn.channelId || '', channel: sn.channelTitle || '',
        vel: days != null ? Math.round(views / Math.max(days, 1)) : 0,
        engRate: views ? +(((likes + comments) / views) * 100).toFixed(2) : 0,
        demand: views + comments * 250 + likes * 10,   // công thức nhu cầu của Fractal
      };
    }
  }
  // subs cho từng kênh (channels.list, 1 unit/50) → viewPerSub (tín hiệu outlier)
  const chIds = [...new Set(Object.values(map).map(v => v.channelId).filter(Boolean))];
  const subs = {};
  for (let i = 0; i < chIds.length; i += 50) {
    try {
      const d = await api('channels', { part: 'statistics', id: chIds.slice(i, i + 50).join(',') }, key);
      for (const it of (d.items || [])) subs[it.id] = +(it.statistics && it.statistics.subscriberCount) || 0;
    } catch (_) {}
  }
  for (const v of Object.values(map)) { v.subs = subs[v.channelId] || 0; v.viewPerSub = v.subs ? +(v.views / v.subs).toFixed(2) : 0; }
  return { key: true, map };
}

module.exports = { enrich, ytKey };
