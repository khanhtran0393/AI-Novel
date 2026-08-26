// nova:smartClip — cắt 1 clip YouTube/Pexels KHỚP CẢNH (smart-clip: search+score+vision+golden-ratio)
// → trả về file clip đã cắt đúng số giây của cảnh, để Dựng Video (Tool 7) gắn làm media cho cảnh.
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path'); const os = require('os');
const { FFMPEG, FFPROBE } = require('./ff-path');   // đường dẫn đã gỡ khỏi app.asar (spawn được)
const { search, downloadOne, searchPexels, downloadPexels, probeVideo, bestWindow } = require('./ipc-clips');
const { visualQuery, scoreCandidates, bannedRanges, smartStart, durOf, _mocChuyenCanh, _catTheoCanh, locRac } = require('./smart-clip');
const CA = require('./clip-anchor');
const { lapDuGiay } = require('./lap-du-giay');
const { soiKhung } = require('./soi-khung');

function run(bin, args, timeoutMs = 120000) {
  return new Promise((res, rej) => { const ps = spawn(bin, args, { windowsHide: true }); let e = ''; const t = setTimeout(() => { try { ps.kill('SIGKILL'); } catch (_) {} rej(new Error('timeout')); }, timeoutMs);
    ps.stderr.on('data', d => e += d); ps.on('error', rej); ps.on('close', c => { clearTimeout(t); c === 0 ? res(true) : rej(new Error(e.split('\n').slice(-2).join(' '))); }); });
}
function tmpDir() { const d = path.join(os.tmpdir(), 'nova-smartclip'); try { fs.mkdirSync(d, { recursive: true }); } catch (_) {} return d; }

// payload: { keyword, narration, duration, vision?, score? }
async function smartClipOne(payload = {}, onProgress = () => {}) {
  const manual = String(payload.keyword || '').trim();   // người dùng gõ tay (ghi đè, tuỳ chọn)
  const dur = Math.max(1.5, Number(payload.duration) || 4);
  const useVision = payload.vision !== false, useScore = payload.score !== false;
  const dir = tmpDir(); const tag = Date.now() + '_' + Math.floor(Math.random() * 1000);

  // TỰ ĐỘNG: dịch lời thoại → cụm hình cụ thể (né ẩn dụ) nếu không gõ tay.
  let keyword = manual;
  if (!keyword) { onProgress(8, 'Dịch nội dung → cụm hình…'); keyword = await visualQuery(payload.narration || '', payload.hint || '', payload.topic || ''); }
  keyword = String(keyword || '').trim();
  if (!keyword) return { ok: false, error: 'Không suy ra được từ khoá (cảnh thiếu lời thoại).' };

  // ── HỒ SƠ ĐỘ CỤ THỂ: gỡ từ trừu tượng + ghim tên riêng của CẢNH NÀY vào truy vấn ──
  const notes = [];
  if (!manual) {   // gõ tay thì tôn trọng nguyên văn người dùng
    const cq = CA.cleanQuery(keyword);
    if (cq.stripped.length) { keyword = cq.query; notes.push('gỡ trừu tượng: ' + cq.stripped.join(', ')); }
  }
  const prof = CA.resolveProfile({ entities: payload.entities, sceneText: payload.narration || '', hint: payload.hint || '' });
  const pinnedQuery = manual ? keyword : CA.applyProfile(keyword, prof);
  if (pinnedQuery !== keyword) notes.push('ghim: ' + prof.active.join(' + '));

  onProgress(15, 'Tìm clip: "' + pinnedQuery.slice(0, 40) + '"…');
  let cands = [], unpinned = false;
  if (payload.pickUrl) {                                   // người dùng chọn tay 1 clip cụ thể → bỏ qua search
    cands = [{ url: String(payload.pickUrl), source: (/youtube|youtu\.be/i.test(payload.pickUrl) ? 'youtube' : 'yt'), title: '(chọn tay)' }];
  } else {
    try { cands = cands.concat(await search(pinnedQuery + ' stock footage', 18)); } catch (_) {}
    // Ghim tên riêng mà không ra kết quả → lùi về truy vấn rộng, thà tìm chung còn hơn cảnh trống.
    if (!cands.length && pinnedQuery !== keyword) {
      unpinned = true; notes.push('ghim không ra clip → tìm rộng');
      try { cands = cands.concat(await search(keyword + ' stock footage', 18)); } catch (_) {}
    }
    // Pexels là kho stock chung, tên riêng vào đây chắc chắn trắng → luôn dùng cụm hình.
    try { cands = cands.concat(await searchPexels(keyword, 8)); } catch (_) {}
  }
  if (!cands.length) return { ok: false, error: 'Không tìm được clip cho cảnh này.' };

  // ── ANCHOR MATCHING: bỏ ứng viên có tiêu đề không dính gì tới cảnh (trước khi tốn công tải) ──
  // Bỏ qua khi người dùng đang TỰ LƯỚT chọn clip (searchOnly) — lúc đó họ muốn thấy hết.
  let anchorInfo = null;
  if (!payload.pickUrl && !payload.searchOnly) {
    const anchors = CA.buildAnchors({ keyword, entities: unpinned ? [] : prof.active, hint: payload.hint || '' });
    const gate = CA.filterByAnchors(cands, anchors);
    anchorInfo = { dropped: gate.dropped, starved: gate.starved, anchors };
    if (gate.starved) notes.push('không ứng viên nào khớp neo → giữ nguyên danh sách');
    else if (gate.dropped) notes.push('loại ' + gate.dropped + ' clip lạc đề');
    cands = gate.kept;
  }

  let srcMeta = null;                                   // {duration, heatmap, start} của clip đã tải
  const _asCand = (cc) => ({ url: cc.url || '', title: cc.title || '', thumbnail: cc.thumbnail || '', durationSec: cc.durationSec || null, source: cc.source || 'youtube' });
  // CHỈ TÌM (không tải): người dùng bấm "Tìm thêm" trong bảng chọn clip → chỉ cần danh sách ứng viên.
  if (payload.searchOnly) { onProgress(100, 'Xong'); return { ok: true, searchOnly: true, query: keyword, candidates: cands.map(_asCand).filter(c => c.url).slice(0, 24) }; }

  /* Lọc rác bằng luật TRƯỚC khi hỏi AI: loại AMV / fan edit / gameplay và
     clip ngắn hơn cảnh. Chạy được cả khi AI hỏng, và đỡ token khi AI sống.
     Lọc sạch hết thì giữ nguyên danh sách — thà có còn hơn trống cảnh.      */
  const _loc = locRac(cands, dur);
  if (_loc.ds.length) {
    const _boN = Object.values(_loc.bo).reduce((a, b) => a + b, 0);
    if (_boN) notes.push('lọc bỏ ' + Object.entries(_loc.bo).map(([k, v]) => v + ' ' + k).join(', '));
    cands = _loc.ds;
  }
  onProgress(45, 'Chấm điểm clip hợp nhất…');
  let bi = 0; if (useScore) { try { bi = await scoreCandidates(payload.narration || keyword, keyword, cands, payload.topic || ''); } catch (_) {} }
  const order = [bi, ...cands.map((_, k) => k).filter(k => k !== bi)];

  const _tries = order.slice(0, 3);
  for (let _ti = 0; _ti < _tries.length; _ti++) {
    const k = _tries[_ti];
    const c = cands[k]; let raw = null;
    try {
      if (c.source === 'pexels') { raw = await downloadPexels(c.url, path.join(dir, `px${tag}_${k}.mp4`)).catch(() => null); }
      else {
        // Trước đây LUÔN tải 30 giây ĐẦU — chỗ tệ nhất của video YouTube (logo, intro,
        // chào khán giả, chữ đè kín). Video 10 phút thì 9 phút rưỡi hay nhất không
        // bao giờ được ngó. Giờ hỏi YouTube đoạn nào KHÁN GIẢ CỦA HỌ tua lại nhiều
        // nhất rồi tải đúng đoạn đó.
        const manualStart = Number(payload.startSec);
        const hasManual = Number.isFinite(manualStart) && manualStart >= 0;
        // Người dùng đã chỉ đoạn → cắt vừa đủ, khỏi tải 30s để vision dò lại.
        const span = hasManual ? (Math.ceil(dur) + 2) : (useVision ? 30 : (Math.ceil(dur) + 3));
        onProgress(55, hasManual ? 'Cắt đúng đoạn bạn chọn…' : 'Hỏi YouTube đoạn được xem lại nhiều nhất…');
        const pv = await probeVideo(c.url).catch(() => ({ duration: 0, heatmap: null }));
        srcMeta = { duration: pv.duration || 0, heatmap: pv.heatmap || null, sb: pv.sb || null };
        const winStart = hasManual ? Math.round(manualStart) : bestWindow(pv.heatmap, pv.duration, span);
        srcMeta.start = winStart;
        if (hasManual) notes.push(`đoạn tự chọn ${winStart}s`);
        else if (winStart > 0) notes.push(pv.heatmap ? `lấy đoạn hot ${winStart}s` : `bỏ intro, lấy từ ${winStart}s`);
        onProgress(62, 'Tải clip…');
        raw = await downloadOne(c.url, span, winStart).catch(() => null);
        // Đoạn hot tải hỏng (chặn theo vùng, live, âm bản) → thử lại kiểu cũ, thà có còn hơn trống.
        if (!raw && winStart > 0) raw = await downloadOne(c.url, span, useVision ? 0 : 2).catch(() => null);
      }
    } catch (_) {}
    if (raw && durOf(raw) > 1.5) {
      let clipStart = 0, src = (c.source || 'yt'), _bannedNho = [];
      /* Soi khung CỤC BỘ luôn chạy — 240ms cho 16 khung, miễn phí, nên không có
         lý do để tắt. Trước đây chỉ có đường Vision API (~8 giây, tốn tiền) nên
         phải để vision:false mặc định, tức gần như KHÔNG clip nào được soi.
         AI Vision giờ chỉ lo việc cục bộ không làm được: clip có ĐÚNG CHỦ ĐỀ không. */
      if (!Number.isFinite(Number(payload.startSec))) {
        try {
          onProgress(74, 'Soi khung (cục bộ) né mặt/chữ…');
          const _cb = await soiKhung(raw, durOf(raw));
          if (_cb && _cb.length) {
            _bannedNho = _cb.slice();
            notes.push(`soi cục bộ: ${_cb.length} dải cấm / ${_cb.soKhung} khung`);
          }
        } catch (_) { /* thiếu mô hình hoặc lỗi ONNX → bỏ qua, không chặn luồng */ }
      }
      if (useVision && !Number.isFinite(Number(payload.startSec))) { onProgress(78, 'Vision né mặt/chữ + kiểm tra đúng chủ đề…'); const md = durOf(raw); const relTopic = payload.topic ? `${keyword} — trong video về: ${String(payload.topic).slice(0, 90)}` : keyword;
        const banned = await bannedRanges(raw, md, relTopic).catch(() => []); _bannedNho = (_bannedNho || []).concat(banned || []); if (banned.offTopic && _ti < _tries.length - 1) { onProgress(80, 'Clip lạc đề — thử clip khác…'); continue; } clipStart = smartStart(md, dur, banned) || 0; src += (banned.length ? '+vision' : '') + (banned.offTopic ? '?' : ''); }
      else { src += '-fast'; }

      /* Bám điểm chuyển cảnh: cắt trọn trong MỘT cảnh quay, không vắt qua lần
         đổi góc máy. Trước đây điểm cắt chọn theo tỉ lệ vàng nên hay rơi giữa
         cú lia hoặc lúc đang zoom — vào timeline là giật.
         Dò bằng ffmpeg có sẵn, không tìm được mốc hợp thì giữ nguyên điểm cũ. */
      if (!Number.isFinite(Number(payload.startSec))) {
        try {
          onProgress(86, 'Dò điểm chuyển cảnh…');
          const _md = durOf(raw);
          const _moc = await _mocChuyenCanh(raw, _md);
          const _t = _catTheoCanh(_moc, _md, dur, _bannedNho);
          if (_t !== null) { clipStart = _t; src += '-canh'; }
          if (_moc.length) notes.push(`${_moc.length} điểm chuyển cảnh` + (_t !== null ? ` → cắt tại ${_t}s` : ' — không cảnh nào đủ dài, giữ điểm cũ'));
        } catch (_) { /* dò hỏng thì giữ nguyên điểm cũ */ }
      }
      // cắt đúng số giây cảnh, chuẩn 1280x720, bỏ tiếng gốc (giọng đọc riêng)
      onProgress(90, 'Cắt đúng thời lượng cảnh…');
      const out = path.join(dir, `clip${tag}.mp4`);
      await run(FFMPEG, ['-ss', String(clipStart), '-i', raw, '-t', String(dur),
        '-vf', 'scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,setsar=1,fps=30',
        '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-movflags', '+faststart', '-y', out]);
      /* Nguồn ngắn hơn cảnh thì ffmpeg lặng lẽ ra file thiếu giây, Remotion
         không lặp nên cảnh ĐỨNG HÌNH phần còn lại. Lấp cho đủ ngay tại đây. */
      if (fs.existsSync(out)) {
        try {
          const _lap = await lapDuGiay(out, dur);
          if (_lap.cach) notes.push(`clip nguồn chỉ ${_lap.tu}s < cảnh ${dur}s → ${_lap.cach} cho đủ`);
        } catch (_) {}
      }
      if (fs.existsSync(out)) { onProgress(100, 'Xong'); return { ok: true, path: out, source: src, query: pinnedQuery, baseQuery: keyword, notes, anchor: anchorInfo, start: +clipStart.toFixed(2), duration: dur,
        srcUrl: c.url, srcDur: srcMeta && srcMeta.duration || 0, heatmap: srcMeta && srcMeta.heatmap || null, sb: srcMeta && srcMeta.sb || null,
        winStart: srcMeta ? srcMeta.start : 0, candidates: payload.pickUrl ? [] : cands.map(_asCand).filter(cc => cc.url).slice(0, 24) }; }
    }
  }
  return { ok: false, error: 'Tải/cắt clip thất bại (mạng hoặc bị chặn).' };
}

function registerSmartClip(ipcMain) {
  // Hỏi RIÊNG thông tin video (thời lượng + heatmap + storyboard) mà không cắt gì.
  // Cần cho ô xem trước khi rê thanh chọn đoạn: clip cắt từ trước chưa có dữ liệu này.
  ipcMain.handle('nova:probeVideo', async (_e, url) => {
    try { const r = await probeVideo(String(url || '')); return { ok: true, ...r }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  });
  const ch = 'nova:smartClip';
  try { ipcMain.removeHandler(ch); } catch (_) {}
  ipcMain.handle(ch, async (e, payload = {}) => {
    try { const onP = (p, m) => { try { e.sender.send('nova:smartClipProgress', { percent: p, message: m }); } catch (_) {} }; return await smartClipOne(payload, onP); }
    catch (err) { return { ok: false, error: String(err && err.message || err).slice(0, 200) }; }
  });
  return [ch];
}
module.exports = { registerSmartClip, smartClipOne };
