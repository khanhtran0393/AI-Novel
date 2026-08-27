/* Flow Image Gen — bảng điều khiển. Điều phối cả mẻ; service worker chỉ là proxy. */

const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, (r) => res(r || {})));

// ─── Chọn segment (model / aspect / count / quality / concurrency) ───
const cfg = { model: 'GEM_PIX_2', aspect: 'IMAGE_ASPECT_RATIO_LANDSCAPE', count: 1, quality: 'orig', conc: 2 };

function wireSeg(id, key, cast = (v) => v) {
  const box = $(id);
  box.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-val]');
    if (!btn) return;
    box.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    cfg[key] = cast(btn.dataset.val);
  });
}
wireSeg('seg-model', 'model');
wireSeg('seg-aspect', 'aspect');
wireSeg('seg-count', 'count', Number);
wireSeg('seg-quality', 'quality');
wireSeg('seg-conc', 'conc', Number);

// ─── Nhật ký ───
function log(msg, cls = 'info') {
  const line = document.createElement('div');
  line.className = 'line';
  const t = new Date().toTimeString().slice(0, 8);
  line.innerHTML = `<span class="t">${t}</span> <span class="${cls}">${escapeHtml(msg)}</span>`;
  const box = $('log');
  box.prepend(line);
  while (box.children.length > 200) box.lastChild.remove();
}
function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

// ─── Trạng thái ───
function renderStatus(s) {
  if (!s) return;
  const conn = $('pill-conn');
  if (s.hasToken) { conn.textContent = '● đã kết nối'; conn.classList.add('on'); }
  else { conn.textContent = '○ chưa kết nối'; conn.classList.remove('on'); }
  $('pill-tier').textContent = 'Gói: ' + (s.paygateTier === 'PAYGATE_TIER_TWO' ? 'Ultra' : s.paygateTier === 'PAYGATE_TIER_ONE' ? 'Pro' : '—');
  $('pill-credits').textContent = 'Credits: ' + (s.credits ?? '—');
  $('pill-email').textContent = s.userEmail || '';
  return s;
}

async function refreshStatus() { renderStatus(await send({ type: 'GET_STATUS' })); }

$('btn-scan').addEventListener('click', async () => { log('Đang quét tài khoản…'); renderStatus(await send({ type: 'SCAN' })); });
$('btn-flow').addEventListener('click', () => send({ type: 'OPEN_FLOW_TAB' }));

chrome.runtime.onMessage.addListener((m) => { if (m?.type === 'STATUS_PUSH') renderStatus(m.status); });

// ─── Đếm prompt ───
$('prompts').addEventListener('input', updatePromptCount);
function readPrompts() {
  return $('prompts').value.split('\n').map((s) => s.trim()).filter(Boolean);
}
function updatePromptCount() { $('prompt-count').textContent = `${readPrompts().length} prompt`; }

// ─── Bộ đếm kết quả ───
const stat = { done: 0, wait: 0, err: 0 };
function renderCounters() {
  $('c-done').textContent = `${stat.done} Xong`;
  $('c-wait').textContent = `${stat.wait} Chờ`;
  $('c-err').textContent = `${stat.err} Lỗi`;
}

// ─── Lưới kết quả ───
const producedUrls = [];
function ensureGrid() {
  const empty = $('results-empty');
  if (empty) empty.remove();
}
function addCard(prompt) {
  ensureGrid();
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `<div class="thumb loading">Đang tạo…</div>
    <div class="meta"><span class="p" title="${escapeHtml(prompt)}">${escapeHtml(prompt)}</span></div>`;
  $('results').appendChild(card);
  return card;
}
function cardImage(card, url, prompt) {
  const thumb = card.querySelector('.thumb');
  thumb.className = 'thumb';
  const img = document.createElement('img');
  img.src = url; img.alt = prompt; img.loading = 'lazy';
  img.onerror = () => { thumb.className = 'thumb err'; thumb.textContent = 'Lỗi tải ảnh'; };
  thumb.textContent = ''; thumb.appendChild(img);
  const btn = document.createElement('button');
  btn.className = 'ghost'; btn.textContent = '⤓';
  btn.title = 'Tải ảnh';
  btn.addEventListener('click', () => downloadOne(url, prompt));
  card.querySelector('.meta').appendChild(btn);
  producedUrls.push({ url, prompt });
  $('btn-download-all').disabled = producedUrls.length === 0;
}
function cardFail(card, err) {
  card.classList.add('failed');
  card.querySelector('.thumb').outerHTML = '';
  const m = document.createElement('div');
  m.className = 'errmsg'; m.textContent = '✗ ' + err;
  card.appendChild(m);
}

// ─── Chất lượng tải về: chỉnh kích thước fife url ───
function sizedUrl(url, quality) {
  if (!url) return url;
  if (quality === 'orig') return url; // giữ nguyên url gốc (đã chạy tốt)
  const base = url.replace(/=[^/]*$/, ''); // bỏ tham số kích thước cũ nếu có
  return base + '=w' + quality;
}

async function downloadOne(url, prompt) {
  try {
    const finalUrl = sizedUrl(url, cfg.quality);
    const resp = await fetch(finalUrl);
    const blob = await resp.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = safeName(prompt) + '.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (e) { log('Tải ảnh lỗi: ' + (e.message || e), 'err'); }
}
function safeName(s) { return (s || 'image').slice(0, 60).replace(/[^\p{L}\p{N}_-]+/gu, '_'); }

$('btn-download-all').addEventListener('click', async () => {
  log(`Đang tải ${producedUrls.length} ảnh…`);
  for (const { url, prompt } of producedUrls) { await downloadOne(url, prompt); await sleep(400); }
});

$('btn-clear').addEventListener('click', () => {
  $('results').innerHTML = `<div class="empty" id="results-empty"><div class="clap">🎬</div><p>Chưa có ảnh nào</p><small>Nhập prompt ở trên rồi bấm “Bắt đầu tạo”.</small></div>`;
  producedUrls.length = 0;
  stat.done = stat.wait = stat.err = 0; renderCounters();
  $('btn-download-all').disabled = true;
});

// ─── Điều phối mẻ tạo ───
let running = false;
let stopFlag = false;

$('btn-stop').addEventListener('click', () => { stopFlag = true; log('Đang dừng sau khi xong các task hiện tại…', 'warn'); });

$('btn-start').addEventListener('click', async () => {
  if (running) return;
  const prompts = readPrompts();
  if (!prompts.length) { alert('Hãy nhập ít nhất 1 prompt.'); return; }

  const status = await send({ type: 'GET_STATUS' });
  renderStatus(status);
  if (!status.hasToken) {
    alert('Chưa có token. Bấm “Mở tab Flow”, đăng nhập Google rồi bấm “Quét lại”.');
    return;
  }

  running = true; stopFlag = false;
  $('btn-start').disabled = true; $('btn-stop').disabled = false;
  stat.done = 0; stat.err = 0; stat.wait = prompts.length; renderCounters();

  // 1) Tạo project dùng chung cho cả mẻ
  log('Tạo project…');
  const proj = await send({ type: 'CREATE_PROJECT', title: `ImageGen ${new Date().toLocaleString('vi-VN')}` });
  if (proj.error || !proj.project_id) {
    log('Không tạo được project: ' + (proj.error || 'unknown'), 'err');
    return finish();
  }
  const projectId = proj.project_id;
  log('Project: ' + projectId, 'ok');

  // 2) Hàng đợi + pool song song
  const tier = status.paygateTier || 'PAYGATE_TIER_ONE';
  const queue = prompts.map((prompt) => ({ prompt, card: addCard(prompt) }));
  let idx = 0;

  async function worker(wid) {
    while (!stopFlag && idx < queue.length) {
      const my = idx++; const task = queue[my];
      log(`[L${wid}] Tạo: "${task.prompt.slice(0, 50)}"…`);
      const res = await send({
        type: 'GEN_IMAGE',
        params: {
          prompt: task.prompt, projectId, aspect: cfg.aspect,
          modelName: cfg.model, tier, variantCount: cfg.count,
        },
      });
      stat.wait = Math.max(0, stat.wait - 1);
      if (res.error) {
        stat.err++; cardFail(task.card, res.error);
        log(`[L${wid}] ✗ ${res.error}`, 'err');
      } else {
        const entries = (res.media_entries || []).filter((e) => e.url);
        if (!entries.length) {
          stat.err++; cardFail(task.card, 'Không có ảnh trả về');
          log(`[L${wid}] ✗ không có ảnh`, 'err');
        } else {
          // Ảnh đầu gắn vào card gốc, phần còn lại tạo card mới.
          cardImage(task.card, entries[0].url, task.prompt);
          for (let k = 1; k < entries.length; k++) {
            const c = addCard(task.prompt);
            cardImage(c, entries[k].url, task.prompt);
          }
          stat.done += entries.length;
          log(`[L${wid}] ✓ ${entries.length} ảnh`, 'ok');
        }
      }
      renderCounters();
    }
  }

  const pool = Array.from({ length: Math.min(cfg.conc, queue.length) }, (_, i) => worker(i + 1));
  await Promise.all(pool);
  log(stopFlag ? 'Đã dừng.' : 'Hoàn tất mẻ tạo.', stopFlag ? 'warn' : 'ok');
  finish();
});

function finish() {
  running = false; stopFlag = false;
  $('btn-start').disabled = false; $('btn-stop').disabled = true;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ─── Khởi tạo ───
updatePromptCount();
renderCounters();
refreshStatus();
setInterval(refreshStatus, 5000);
log('Sẵn sàng. Nếu chưa kết nối: mở tab Flow, đăng nhập rồi Quét lại.');
