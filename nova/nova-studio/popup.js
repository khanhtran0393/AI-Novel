/* Popup nhỏ gọn — hiển thị trạng thái + nút nhanh. */

const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, (r) => res(r || {})));

function fmtAge(ms) {
  if (ms == null) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  return Math.floor(s / 3600) + 'h';
}

function render(s) {
  if (!s) return;
  const dot = $('st-dot');
  const conn = $('r-conn');
  if (s.hasToken) {
    dot.classList.add('on');
    conn.textContent = '● đã kết nối'; conn.className = 'val ok';
  } else {
    dot.classList.remove('on');
    conn.textContent = '○ chưa có token'; conn.className = 'val bad';
  }
  $('st-credits').textContent = s.credits ?? '—';
  $('st-age').textContent = fmtAge(s.tokenAge);
  $('r-tier').textContent = s.paygateTier === 'PAYGATE_TIER_TWO' ? 'Ultra'
    : s.paygateTier === 'PAYGATE_TIER_ONE' ? 'Pro' : '—';
  const nAcc = s.accountCount || (s.hasToken ? 1 : 0);
  $('r-email').textContent = (s.userEmail || '—') + (nAcc > 1 ? `  (⚡ ${nAcc} account)` : '');
  if (nAcc > 1 && typeof s.credits === 'number' && Array.isArray(s.accounts)) {
    const total = s.accounts.reduce((sum, a) => sum + (a.credits || 0), 0);
    $('st-credits').textContent = total;
  }
}

async function refresh() { render(await send({ type: 'GET_STATUS' })); }

try { $('ver').textContent = 'v' + chrome.runtime.getManifest().version; } catch {}

$('btn-scan').addEventListener('click', async () => {
  $('r-conn').textContent = 'đang quét…';
  render(await send({ type: 'SCAN' }));
});
$('btn-flow').addEventListener('click', () => send({ type: 'OPEN_FLOW_TAB' }));
$('btn-open').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
  window.close();
});

chrome.runtime.onMessage.addListener((m) => { if (m?.type === 'STATUS_PUSH') render(m.status); });

refresh();
setInterval(refresh, 3000);
