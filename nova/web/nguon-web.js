/* ══ NGUỒN WEB — 55 nền tảng, bật/tắt từng cái ═══════════════════════════════
   Bộ nền tảng và luật lọc URL bê từ folder "test tool"
   (main/source-search-service/platform-registry.js), sinh thẳng từ file đó chứ
   không chép tay. Registry gốc KHÔNG có trường giấy phép nào — chỉ id, label,
   discoverySite, domains, smokeQuery — nên nhóm pháp lý ('cong' · 'bao' · 'xh')
   là do bên này tự gán, để còn cảnh báo được bản quyền trên từng ứng viên.

   TẦNG TÌM thì KHÔNG bê nguyên. Đo lại tháng 8/2026:
     · SearXNG worker  → 401, cần key không có sẵn
     · Bing HTML       → 200 mà 0 kết quả (giờ bọc link trong bing.com/ck/a?u=a1<base64>)
     · DuckDuckGo HTML → ~100 truy vấn là 403 chặn IP
   Nên: nền tảng nào có API tìm riêng thì gọi thẳng API (không key, không chặn),
   còn lại mới lùi về tìm web — và tìm web có phanh nhịp + bộ nhớ đệm, vì một
   video 380 cảnh × 10 nền tảng = 3.800 truy vấn, đủ để bị khoá trong một phút. */

/* ── Luật chặn chung: trang chủ, trang tìm kiếm, trang chuyên mục — không phải
      trang video cụ thể nên tải về là ra rác. ── */
const _WEB_CAM_CHUNG = [
  /\.(?:pdf|docx?|pptx?|xlsx?)(?:[?#].*)?$/i,
  /^https?:\/\/[^/]+\/?$/i,
  /\/(?:search|results)(?:[/?#]|$)/i,
  /[?&](?:q|query|search|keyword)=/i,
  /\/(?:tag|tags|topic|topics|category|categories)(?:[/?#]|$)/i,
];

const NOVA_WEB_NEN_TANG = [
  /* ── KHO ẢNH · VIDEO SẴN — mỗi cái có API riêng, KHÔNG đi đường cào trang.
     Trường `may` bảo tầng lấy tư liệu dùng máy nào:
       'stock' → searchAllSources (Pexels/Pixabay/Unsplash)
       'kho'   → searchOpenArchives (Wikimedia/NASA/Openverse/Archive.org)
       'yt'    → smartClip (dịch lời thoại → tìm → chấm điểm → cắt)
     Không có `may` thì đi đường chung: tìm kiếm + yt-dlp.                    */
  { id:'pexels', thuQ:"city street", ten:"Pexels", site:'pexels.com', mien:['pexels.com'], nhom:'kho', may:'stock', canKhoa:true },
  { id:'pixabay', thuQ:"nature landscape", ten:"Pixabay", site:'pixabay.com', mien:['pixabay.com'], nhom:'kho', may:'stock', canKhoa:true },
  { id:'unsplash', thuQ:"city street", ten:"Unsplash", site:'unsplash.com', mien:['unsplash.com'], nhom:'kho', may:'stock', canKhoa:true, chiAnh:true },
  { id:'nasa', thuQ:"earth from space", ten:"NASA", site:'images.nasa.gov', mien:['nasa.gov'], nhom:'kho', may:'kho' },
  { id:'openverse', thuQ:"forest nature", ten:"Openverse", site:'openverse.org', mien:['openverse.org'], nhom:'kho', may:'kho' },

  // ── CÔNG / TƯ LIỆU CÔNG — public domain hoặc cho tái sử dụng tự do ──
  { id:'archive_org', thuQ:"public domain historical documentary", ten:"Archive.org", site:'archive.org', mien:['archive.org'], nhom:'cong', api:'archive', may:'kho', cho:[/archive\.org\/details\//i] },
  { id:'wikimedia', thuQ:"science educational clip", ten:"Wikimedia", site:'wikimedia.org', mien:['wikimedia.org'], nhom:'cong', api:'wikimedia', may:'kho', cho:[/commons\.wikimedia\.org\/wiki\/file:[^?#]+\.(?:ogv|webm|mp4|mov|m4v|mkv)(?:[?#]|$)/i,/upload\.wikimedia\.org\/.*\.(?:ogv|webm|mp4|mov|m4v|mkv)(?:[?#]|$)/i], cam:[/outreach\.wikimedia\.org\//i,/wikimedia\.org\/wiki\/(?!file:)/i] },
  { id:'web_archive_youtube', thuQ:"archived youtube documentary", ten:"Web Archive YouTube", site:'web.archive.org', mien:['web.archive.org'], nhom:'cong', cho:[/web\.archive\.org\/web\/\d+\/https?:\/\/(?:www\.)?youtube\.com\/watch\?v=/i] },
  { id:'cspan', thuQ:"congressional hearing", ten:"C-SPAN", site:'c-span.org', mien:['c-span.org'], nhom:'cong', cho:[/c-?span\.org\/video\/(?:\?|[0-9])/i] },
  { id:'senate_gov', thuQ:"senate hearing", ten:"Senate.gov", site:'senate.gov', mien:['senate.gov'], nhom:'cong', cho:[/senate\.gov\/isvp\//i,/senate\.gov\/committees?\/hearings\//i,/senate\.gov\/hearings\//i] },
  { id:'parliamentlive_tv', thuQ:"prime minister questions", ten:"ParliamentLive.tv", site:'parliamentlive.tv', mien:['parliamentlive.tv'], nhom:'cong', cho:[/parliamentlive\.tv\/event\/index\//i] },
  { id:'bundestag', thuQ:"bundestag plenary debate", ten:"Bundestag", site:'bundestag.de', mien:['bundestag.de'], nhom:'cong', cho:[/bundestag\.de\/mediathek/i] },

  // ── BÁO · ĐÀI THƯƠNG MẠI — nội dung CÓ BẢN QUYỀN, rủi ro Content ID ──
  { id:'pbs', thuQ:"pbs nature documentary clip", ten:"PBS", site:'pbs.org', mien:['pbs.org'], nhom:'bao', cho:[/pbs\.org\/video\//i] },
  { id:'natgeo', thuQ:"wildlife nature clip", ten:"National Geographic", site:'nationalgeographic.com', mien:['nationalgeographic.com','natgeotv.com'], nhom:'bao', cho:[/nationalgeographic\.com\/video\//i,/natgeotv\.com\/video\//i] },
  { id:'redbull', thuQ:"action sports downhill", ten:"Red Bull", site:'redbull.com', mien:['redbull.com','redbulltv.com'], nhom:'bao', cho:[/redbull(?:tv)?\.com\/.*\/videos?\//i] },
  { id:'raiplay', thuQ:"italian documentary", ten:"RaiPlay", site:'raiplay.it', mien:['raiplay.it'], nhom:'bao', cho:[/raiplay\.it\/video\//i] },
  { id:'rainews', thuQ:"current events report", ten:"Rai News", site:'rainews.it', mien:['rainews.it'], nhom:'bao', cho:[/rainews\.it\/video\//i] },
  { id:'rtve_alacarta', thuQ:"documental historia", ten:"RTVE A la Carta", site:'rtve.es', mien:['rtve.es'], nhom:'bao', cho:[/rtve\.es\/play\/videos?\//i,/rtve\.es\/videos?\//i] },
  { id:'rtve_live', thuQ:"noticias directo", ten:"RTVE Live", site:'rtve.es', mien:['rtve.es'], nhom:'bao', cho:[/rtve\.es\/play\/videos?\//i,/rtve\.es\/directo\//i] },
  { id:'francetv', thuQ:"documentaire histoire", ten:"France.tv", site:'france.tv', mien:['france.tv'], nhom:'bao', cho:[/france\.tv\/.*\/videos?\//i] },
  { id:'arte_tv', thuQ:"arte documentary culture", ten:"Arte.tv", site:'arte.tv', mien:['arte.tv'], nhom:'bao', cho:[/arte\.tv\/[a-z]{2}\/videos?\//i],
    timTrang:{ url:'https://www.arte.tv/en/search/?q=', dom:'arte.tv' } },
  { id:'bbc', thuQ:"bbc history documentary clip", ten:"BBC", site:'bbc.co.uk', mien:['bbc.co.uk','bbc.com'], nhom:'bao', cho:[/bbc\.(?:co\.uk|com)\/iplayer\/episode\//i,/bbc\.(?:co\.uk|com)\/news\/videos\//i,/bbc\.(?:co\.uk|com)\/reel\/video\//i,/bbc\.(?:co\.uk|com)\/programmes\//i], cam:[/bbc\.(?:co\.uk|com)\/(?:news\/)?videos\/?$/i] },
  { id:'cbc_player', thuQ:"canadian news report", ten:"CBC Player", site:'cbc.ca/player', mien:['cbc.ca'], nhom:'bao', cho:[/cbc\.ca\/player\/play\/video\//i] },
  { id:'nbc_news', thuQ:"nbc news report", ten:"NBC News", site:'nbcnews.com', mien:['nbcnews.com'], nhom:'bao', cho:[/nbcnews\.com\/video\//i] },
  { id:'cbs_news', thuQ:"cbs news interview", ten:"CBS News", site:'cbsnews.com', mien:['cbsnews.com'], nhom:'bao', cho:[/cbsnews\.com\/video\//i] },
  { id:'cnn', thuQ:"cnn report footage", ten:"CNN", site:'cnn.com', mien:['cnn.com'], nhom:'bao', cho:[/cnn\.com\/(?:.+\/)?video\//i,/cnn\.com\/videos\/[^/?#]+/i], cam:[/cnn\.com\/videos\/?$/i] },
  { id:'bloomberg', thuQ:"markets interview clip", ten:"Bloomberg", site:'bloomberg.com', mien:['bloomberg.com'], nhom:'bao', cho:[/bloomberg\.com\/news\/videos?\//i,/bloomberg\.com\/videos?\//i], cam:[/bloomberg\.com\/videos\/?$/i] },
  { id:'cnbc', thuQ:"economy report clip", ten:"CNBC", site:'cnbc.com', mien:['cnbc.com'], nhom:'bao', cho:[/cnbc\.com\/video\//i] },
  { id:'business_insider', thuQ:"tech explainer video", ten:"Business Insider", site:'businessinsider.com', mien:['businessinsider.com'], nhom:'bao', cho:[/businessinsider\.com\/video/i] },
  { id:'al_jazeera', thuQ:"international news report", ten:"Al Jazeera", site:'aljazeera.com', mien:['aljazeera.com'], nhom:'bao', cho:[/aljazeera\.com\/videos?\//i,/aljazeera\.com\/program\//i] },
  { id:'cgtn', thuQ:"world news report", ten:"CGTN", site:'cgtn.com', mien:['cgtn.com'], nhom:'bao', cho:[/cgtn\.com\/video\//i] },
  { id:'cctv', thuQ:"china culture documentary", ten:"CCTV", site:'cctv.com', mien:['cctv.com','cntv.cn'], nhom:'bao', cho:[/cctv\.com\/(?:video|videos)\//i,/cntv\.cn\/video\//i] },
  { id:'democracy_now', thuQ:"democracy now interview", ten:"Democracy Now", site:'democracynow.org', mien:['democracynow.org'], nhom:'bao', cho:[/democracynow\.org\/\d{4}\/\d{1,2}\/\d{1,2}\//i],
    timTrang:{ url:'https://www.democracynow.org/search?search_term=', dom:'democracynow.org' } },
  { id:'npr', thuQ:"npr interview", ten:"NPR", site:'npr.org', mien:['npr.org'], nhom:'bao', cho:[/npr\.org\/\d{4}\/\d{2}\/\d{2}\//i] },
  { id:'nytimes', thuQ:"new york times documentary clip", ten:"New York Times", site:'nytimes.com', mien:['nytimes.com'], nhom:'bao', cho:[/nytimes\.com\/video\//i] },
  { id:'washington_post', thuQ:"washington post explainer video", ten:"Washington Post", site:'washingtonpost.com', mien:['washingtonpost.com'], nhom:'bao', cho:[/^arcpublishing:wapo:/i,/washingtonpost\.com\/video\//i] },
  { id:'guardian', thuQ:"guardian interview documentary", ten:"The Guardian", site:'theguardian.com', mien:['theguardian.com','guardian.co.uk'], nhom:'bao', cho:[/theguardian\.com\/.*\/video\//i,/theguardian\.com\/.*\/audio\//i] },
  { id:'vox_media', thuQ:"vox explainer video", ten:"Vox Media", site:'vox.com', mien:['vox.com','voxmedia.com'], nhom:'bao', cho:[/vox\.com\/videos?\//i,/voxmedia\.com\/videos?\//i] },
  { id:'conde_nast', thuQ:"travel lifestyle video", ten:"Conde Nast", site:'condenast.com', mien:['condenast.com','wired.com','gq.com','newyorker.com'], nhom:'bao', cho:[/(?:condenast|wired|gq|newyorker|bonappetit|architecturaldigest|vogue|vanityfair)\.com\/video\//i] },
  { id:'gopro', thuQ:"mountain biking action clip", ten:"GoPro", site:'gopro.com', mien:['gopro.com'], nhom:'bao', cho:[/gopro\.com\/v\//i] },
  { id:'internet_video_archive', thuQ:"movie trailer", ten:"Internet Video Archive", site:'internetvideoarchive.com', mien:['internetvideoarchive.com'], nhom:'bao', cho:[/internetvideoarchive\.com\/.*\/(?:video|player)/i] },

  // ── MẠNG XÃ HỘI · NỀN TẢNG — bản quyền thuộc người đăng, nhiều nơi cấm tải ──
  { id:'youtube', thuQ:"documentary b roll", ten:"YouTube", site:'youtube.com/watch', mien:['youtube.com','youtu.be'], nhom:'xh', may:'yt', api:'ytdlp', cho:[/youtube\.com\/watch\?v=/i,/youtube\.com\/shorts\//i,/youtu\.be\/[^/?#]+/i], cam:[/youtube\.com\/results/i,/youtube\.com\/playlist/i,/youtube\.com\/(?:channel|user|c)\/?/i,/youtube\.com\/@[^/]+\/?$/i] },
  { id:'vimeo', thuQ:"cinematic travel short film", ten:"Vimeo", site:'vimeo.com', mien:['vimeo.com'], nhom:'xh', cho:[/vimeo\.com\/\d+(?:$|[?#/])/i] },
  { id:'dailymotion', thuQ:"news footage interview", ten:"Dailymotion", site:'dailymotion.com', mien:['dailymotion.com','dai.ly'], nhom:'xh', api:'dailymotion', cho:[/dailymotion\.com\/video\//i,/dai\.ly\/[^/?#]+/i] },
  { id:'peer_tube', thuQ:"indie documentary", ten:"PeerTube", site:'sepiasearch.org', mien:['sepiasearch.org','joinpeertube.org'], nhom:'xh', api:'peertube', cho:[/\/videos\/watch\//i,/\/w\/[A-Za-z0-9-]+/i] },
  { id:'flickr', thuQ:"city travel video", ten:"Flickr", site:'flickr.com', mien:['flickr.com'], nhom:'xh', cho:[/flickr\.com\/photos\/[^/]+\/\d+/i] },
  { id:'imgur', thuQ:"gif video clip", ten:"Imgur", site:'imgur.com', mien:['imgur.com'], nhom:'xh', cho:[/imgur\.com\/(?:gallery|a)\//i,/imgur\.com\/[A-Za-z0-9]{5,8}(?:[?#]|$)/i] },
  { id:'pinterest', thuQ:"design inspiration video", ten:"Pinterest", site:'pinterest.com', mien:['pinterest.com'], nhom:'xh', cho:[/pinterest\.com\/pin\//i] },
  { id:'instagram', thuQ:"travel reel", ten:"Instagram", site:'instagram.com', mien:['instagram.com'], nhom:'xh', cho:[/instagram\.com\/(?:reel|p)\//i] },
  { id:'tiktok', thuQ:"science explainer", ten:"TikTok", site:'tiktok.com', mien:['tiktok.com'], nhom:'xh', cho:[/tiktok\.com\/@[^/]+\/video\//i] },
  { id:'snapchat_spotlight', thuQ:"spotlight travel clip", ten:"Snapchat Spotlight", site:'snapchat.com', mien:['snapchat.com'], nhom:'xh', cho:[/snapchat\.com\/spotlight\//i] },
  { id:'reddit', thuQ:"interesting documentary clip", ten:"Reddit", site:'reddit.com', mien:['reddit.com','v.redd.it','redd.it'], nhom:'xh', cho:[/v\.redd\.it\//i,/reddit\.com\/r\/[^/]+\/comments\//i,/redd\.it\/[A-Za-z0-9]+/i] },
  { id:'bilibili', thuQ:"tech culture documentary", ten:"BiliBili", site:'bilibili.com', mien:['bilibili.com','b23.tv'], nhom:'xh', cho:[/bilibili\.com\/video\//i,/b23\.tv\/[A-Za-z0-9]+/i], cam:[/bilibili\.com\/read\//i,/bilibili\.com\/opus\//i] },
  { id:'twitter', thuQ:"news clip", ten:"Twitter/X", site:'twitter.com', mien:['twitter.com','x.com'], nhom:'xh', cho:[/x\.com\/[^/]+\/status\//i,/twitter\.com\/[^/]+\/status\//i] },
  { id:'facebook', thuQ:"facebook watch documentary", ten:"Facebook", site:'facebook.com', mien:['facebook.com','fb.watch'], nhom:'xh', cho:[/facebook\.com\/watch\/?\?v=/i,/facebook\.com\/.*\/videos\//i,/fb\.watch\//i] },
];

const _WEB_NHOM = {
  kho:  { ten: 'Kho ảnh · video sẵn', icon: '🗂', mau: 'var(--teal)',
          mo: 'Có API riêng, trả về ẢNH và VIDEO kèm giấy phép rõ — không phải cào trang. Pexels · Pixabay · Unsplash cần khoá API (Cài đặt → Tìm Media); NASA · Openverse · Wikimedia · Archive.org thì miễn phí.' },
  cong: { ten: 'Tư liệu công', icon: '🏛', mau: 'var(--teal)',
          mo: '' },
  bao:  { ten: 'Báo · đài thương mại', icon: '📺', mau: 'var(--amber)',
          mo: '' },
  xh:   { ten: 'Mạng xã hội · nền tảng', icon: '🌐', mau: 'var(--amber)',
          mo: '' },
};

const _webById = (id) => NOVA_WEB_NEN_TANG.find((x) => x.id === id) || null;

/* ── Giấy phép CẤM dùng cho kênh kiếm tiền ─────────────────────────────────
   -nc = cấm thương mại, -nd = cấm sửa đổi (cắt clip, đè chữ đều là sửa đổi).
   PeerTube ghi giấy phép bằng CHỮ ĐẦY ĐỦ ("Attribution - Non Commercial -
   Share Alike") chứ không viết tắt, nên bộ lọc chỉ soi 'nc'/'nd' đứng riêng là
   lọt sạch — đã đo: 4/179 ứng viên dính NC/ND mà vẫn qua.                   */
const _WEB_GP_CAM = [
  /(^|[-\s])n[cd]([-\s]|$)/i,          // by-nc-sa, by-nd, CC BY-NC 4.0
  /non[\s-]?commercial/i,              // "Non Commercial"
  /no[\s-]?deriv/i,                    // "NoDerivs", "No Derivatives"
  /\ball rights reserved\b/i,
];
function _webGpCam(lic) {
  const s = String(lic || '');
  return !!s && _WEB_GP_CAM.some((r) => r.test(s));
}

// yt-dlp lấy tiêu đề từ thẻ <title> nên trả về nguyên entity HTML
// ("Trump&#8217;s &#8220;Takeover&#8221;"). Gỡ trước khi hiện lên thẻ.
function _webGoEntity(v) {
  const s = String(v == null ? '' : v);
  if (!/&[#a-z0-9]+;/i.test(s)) return s.trim();
  try {
    const d = document.createElement('textarea');
    d.innerHTML = s;
    return String(d.value || s).trim();
  } catch (_) { return s.trim(); }
}

/* ── Lọc URL: đúng luật của nền tảng mới nhận ───────────────────────────────
   Cùng thuật toán evaluateSourceVideoPlatformUrl() bên test tool: chặn chung
   trước, rồi 'cam' của nền tảng, rồi bắt buộc khớp 'cho' nếu nền tảng có.    */
function _webUrlHop(platId, url) {
  const u = String(url || '').trim();
  if (!u) return false;
  if (_WEB_CAM_CHUNG.some((r) => r.test(u))) return false;
  const p = _webById(platId);
  if (!p) return false;
  if ((p.cam || []).some((r) => r.test(u))) return false;
  /* Chặn theo TÊN MIỀN trước khi so mẫu đường dẫn. Trước đây chỉ so mẫu, nên
     một URL của trang khác mà tình cờ chứa đoạn giống mẫu vẫn lọt — rồi tốn
     một lượt gọi yt-dlp để nhận về "Unsupported URL". Đã gặp thật khi tìm
     Reddit (một link geoffboeing.com lọt qua).                              */
  if ((p.mien || []).length) {
    let host = '';
    try { host = new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch (_) { return false; }
    const hopMien = p.mien.some((d) => {
      const m = String(d).toLowerCase().replace(/^www\./, '');
      return host === m || host.endsWith('.' + m);
    });
    if (!hopMien) return false;
  }
  if ((p.cho || []).length && !(p.cho || []).some((r) => r.test(u))) return false;
  return true;
}

// URL này thuộc nền tảng nào (so theo domain, khớp cả subdomain).
function _webNhanDang(url) {
  let host = '';
  try { host = new URL(String(url)).hostname.toLowerCase(); } catch (_) { return ''; }
  for (const p of NOVA_WEB_NEN_TANG) {
    if ((p.mien || []).some((d) => { const m = String(d).toLowerCase(); return host === m || host.endsWith('.' + m); })) return p.id;
  }
  return '';
}

/* ══ TRẠNG THÁI BẬT/TẮT ══════════════════════════════════════════════════════
   Mặc định bật đúng nhóm tư liệu công — nhóm duy nhất không có rủi ro bản
   quyền. Muốn bật báo đài / mạng xã hội thì tự vào bảng tick, để việc đó là
   một lựa chọn có ý thức chứ không phải mặc định lặng lẽ.                    */
const _WEB_MAC_DINH = NOVA_WEB_NEN_TANG.filter((p) => p.nhom === 'cong').map((p) => p.id);

function _webBat() {
  // `state` khai báo bằng const trong index.html → nằm ở global lexical
  // environment, KHÔNG lên window. Hỏi window.state là luôn undefined và cả bộ
  // bật/tắt câm lặng — phải hỏi bằng tên trần.
  if (typeof state === 'undefined' || !state) return {};
  if (!state.webBat || typeof state.webBat !== 'object') {
    state.webBat = {};
    _WEB_MAC_DINH.forEach((id) => { state.webBat[id] = true; });
  }
  return state.webBat;
}
function _webDangBat() {
  const b = _webBat();
  return NOVA_WEB_NEN_TANG.filter((p) => b[p.id]);
}
function webToggle(id) {
  const b = _webBat();
  b[id] = !b[id];
  webRenderBang();
  try { if (typeof t2RenderNguon === 'function') t2RenderNguon(); } catch (_) {}
  try { if (typeof saveState === 'function') saveState(); } catch (_) {}
}
function webToggleNhom(nhom, bat) {
  const b = _webBat();
  NOVA_WEB_NEN_TANG.filter((p) => p.nhom === nhom).forEach((p) => { b[p.id] = !!bat; });
  webRenderBang();
  try { if (typeof t2RenderNguon === 'function') t2RenderNguon(); } catch (_) {}
  try { if (typeof saveState === 'function') saveState(); } catch (_) {}
}

/* ══ BẢNG CHỌN NỀN TẢNG ══════════════════════════════════════════════════════ */
function webMoBang() {
  let m = document.getElementById('webBangModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'webBangModal';
    m.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.62);display:flex;align-items:center;justify-content:center;padding:22px';
    m.addEventListener('click', (e) => { if (e.target === m) m.style.display = 'none'; });
    document.body.appendChild(m);
  }
  m.style.display = 'flex';
  webRenderBang();
}
function webDongBang() {
  const m = document.getElementById('webBangModal');
  if (m) m.style.display = 'none';
}

/* Khoá của ba kho ảnh nằm bên index.html. Gọi bằng tên trần vì chúng khai báo
   bằng function/const ở top-level script → không lên window.               */
function _webCoKhoaKho(id) {
  try {
    if (id === 'pexels')   return typeof getPexelsKey === 'function' && !!getPexelsKey();
    if (id === 'pixabay')  return typeof getPixabayKey === 'function' && !!getPixabayKey();
    if (id === 'unsplash') return typeof getUnsplashKey === 'function' && !!getUnsplashKey();
  } catch (_) {}
  return true;
}
/* ══ KIỂM TRA NỀN TẢNG ════════════════════════════════════════════════════
   Vạch màu chỉ nói nền tảng CÓ API hay không — là dự đoán. Cái người dùng cần
   biết là nó CÓ RA KẾT QUẢ KHÔNG. Nên chạy thử một truy vấn qua từng nền tảng
   rồi ghi lại. Kết quả nằm trong state.webTT nên mở bảng lần sau không phải
   kiểm lại.
     ok  = ra ≥1 ứng viên
     ko  = chạy được nhưng không ra gì (hoặc lỗi)
     khoa = thiếu khoá API, chưa kiểm được
   Truy vấn thử cố tình dùng từ phổ thông: nền tảng nào cũng phải có mới đúng
   là "chạy được".                                                            */
/* Mỗi nền tảng một truy vấn thử RIÊNG, hợp với thứ nó thật sự có. Thử C-SPAN
   bằng "city street" thì đương nhiên trắng tay — nó là kho phiên điều trần
   Quốc hội. Bộ truy vấn này lấy từ registry của test tool.                   */
const _WEB_THU_Q = 'city street';
const _webThuQ = (p) => String((p && p.thuQ) || _WEB_THU_Q);
let _webDangKiem = false;
let _webCanhBao = '';   // lời nhắc hiện ở đầu bảng khi kiểm bị chặn

function _webTT() {
  if (typeof state === 'undefined' || !state) return {};
  if (!state.webTT || typeof state.webTT !== 'object') state.webTT = {};
  return state.webTT;
}

/* Kiểm MỘT nền tảng. Trả {tt, so, loi}. Không ném lỗi ra ngoài. */
async function _webKiemMot(p) {
  try {
    if (p.canKhoa && !_webCoKhoaKho(p.id)) return { tt: 'khoa', so: 0, loi: 'chưa cắm khoá API' };
    // Nền tảng do máy stock/kho/yt lo → hỏi thẳng máy đó.
    /* Các hàm tìm nằm bên index.html, khai báo bằng `async function` ở top-level
       của script thường → CÓ lên window (khác const/let). Gọi qua window là đủ. */
    if (p.may === 'stock' || p.may === 'kho') {
      const ten = { pexels: 'searchPexels', pixabay: 'searchPixabay', unsplash: 'searchUnsplash',
                    wikimedia: '_khoWikimedia', nasa: '_khoNasa',
                    openverse: '_khoOpenverse', archive_org: '_khoArchive' }[p.id];
      const fn = ten && window[ten];
      if (typeof fn !== 'function') return { tt: 'ko', so: 0, loi: 'chưa nạp được hàm tìm' };
      // searchPexels/... nhận (q, type) trả {photos,videos}; _kho... nhận (q, n) trả mảng.
      const r = (p.may === 'stock') ? await fn(_webThuQ(p), 'both') : await fn(_webThuQ(p), 4);
      const so = Array.isArray(r)
        ? r.filter(Boolean).length
        : ((r && r.photos) || []).length + ((r && r.videos) || []).length;
      if (so) return { tt: 'ok', so };
      /* Archive.org có HAI đường: ảnh qua _khoArchive, video qua _WEB_API.archive.
         Đường này rỗng thì thử đường kia trước khi kết luận là hỏng.          */
      if (p.api && _WEB_API[p.api]) {
        try {
          const r2 = await _WEB_API[p.api](_webThuQ(p), 4);
          if ((r2 || []).length) return { tt: 'ok', so: r2.length };
        } catch (_) {}
      }
      const e = r && r._err;
      return { tt: 'ko', so: 0, loi: (Array.isArray(e) ? e[0] : e) || 'không ra kết quả' };
    }
    // Còn lại: đúng đường mà lúc chạy thật sẽ đi.
    let ra;
    if (p.api && _WEB_API[p.api]) ra = await _WEB_API[p.api](_webThuQ(p), 4);
    else ra = await _webTimQuaCongCu(p.id, _webThuQ(p), 4);
    const so = (ra || []).length;
    return so ? { tt: 'ok', so } : { tt: 'ko', so: 0, loi: 'không ra kết quả' };
  } catch (e) {
    return { tt: 'ko', so: 0, loi: String((e && e.message) || e).slice(0, 60) };
  }
}

/* Máy tìm chết thì MỌI nền tảng nhóm ○ đều trắng tay, và bảng sẽ đỏ oan hàng
   loạt. Đã gặp thật: SearXNG chạy tốt, thử nặng một lúc rồi trả 0 kết quả cho
   cả "city street" — engine thượng nguồn chặn nhịp. Nên hỏi một câu đối chứng
   trước; máy tìm câm thì báo thẳng chứ đừng đổ tội cho nền tảng.             */
async function _webMayTimCon() {
  const K = _webKey();
  if (!(K.key && K.may === 'brave') && !(K.may === 'searxng' && K.base)) return { con: true, vi: 'không dùng khoá' };
  try {
    const r = (K.may === 'brave')
      ? await _webBrave('city street', 5, K.key)
      : await _webSearxng('city street', 5, K.base, K.key);
    return (r || []).length ? { con: true } : { con: false, vi: 'trả 0 kết quả cho câu đối chứng' };
  } catch (e) {
    return { con: false, vi: String((e && e.message) || e).slice(0, 60) };
  }
}

async function webKiemTra() {
  if (_webDangKiem) { _webDangKiem = false; return; }          // bấm lần hai = dừng
  const b = _webBat();
  const ds = NOVA_WEB_NEN_TANG.filter((x) => b[x.id]);
  if (!ds.length) return;
  const tt = _webTT();

  // Có nền tảng nào phải nhờ máy tìm không? Có thì kiểm máy tìm trước.
  if (ds.some((x) => !x.api && !x.may && !x.timTrang)) {
    _webCanhBao = 'Đang thử máy tìm…';
    webRenderBang();
    const m = await _webMayTimCon();
    if (!m.con) {
      _webCanhBao = 'Máy tìm đang không trả kết quả (' + m.vi + '). Nếu kiểm lúc này thì nhóm ○ sẽ đỏ OAN — nghỉ vài phút rồi bấm lại, hoặc đổi sang khoá Brave.';
      webRenderBang();
      return;
    }
    _webCanhBao = '';
  }
  _webDangKiem = true;
  ds.forEach((x) => { tt[x.id] = Object.assign({}, tt[x.id], { dangChay: true }); });
  webRenderBang();

  // Dùng đúng số luồng người dùng đặt ở Tool 2; phanh nhịp đã nối đuôi riêng.
  const N = (typeof _t2SoLuong === 'function') ? _t2SoLuong() : 3;
  let ke = 0;
  const chay = async () => {
    while (_webDangKiem) {
      const i = ke++;
      if (i >= ds.length) return;
      const p = ds[i];
      const r = await _webKiemMot(p);
      tt[p.id] = { tt: r.tt, so: r.so || 0, loi: r.loi || '', luc: _webGio() };
      webRenderBang();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(N, ds.length)) }, chay));
  ds.forEach((x) => { if (tt[x.id] && tt[x.id].dangChay) delete tt[x.id].dangChay; });
  _webDangKiem = false;
  try { if (typeof saveState === 'function') saveState(); } catch (_) {}
  webRenderBang();
}

/* Date.now() gói riêng cho dễ đọc — chỉ dùng để hiện "kiểm lúc mấy giờ". */
function _webGio() { return Date.now(); }
function _webGioChu(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
  const nay = new Date(); const cungNgay = d.toDateString() === nay.toDateString();
  return cungNgay ? `${hh}:${mm}` : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${hh}:${mm}`;
}

let _webMoCauHinh = false;                 // giữ trạng thái mở/đóng của ngăn khoá
function webToggleCauHinh(){ _webMoCauHinh = !_webMoCauHinh; webRenderBang(); }

function webRenderBang() {
  const m = document.getElementById('webBangModal');
  if (!m || m.style.display === 'none') return;
  const b = _webBat();
  const esc = (s) => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s));
  const tt = _webTT();

  /* Thiết kế lại: bản cũ vẽ 55 ô đều nhau, ô nào cũng có viền màu + ba ký hiệu
     (☑ ● 🔑) đứng trước tên → mắt không biết nhìn đâu trước. Nay:
       · TRẠNG THÁI đọc bằng NỀN, không bằng viền — bật thì có nền, tắt thì phẳng.
       · BẬC nguồn (●◐○) thành VẠCH MÀU bên trái, đọc lướt được cả cột.
       · 🔑 chỉ hiện khi THIẾU khoá; đủ khoá thì im, đỡ một ký hiệu thừa.
       · Ngăn cấu hình khoá tìm kiếm gập lại — nó là thiết lập phụ, không phải
         thứ cần chiếm chỗ ngay dưới tiêu đề mỗi lần mở bảng.                 */
  const nhomHtml = ['kho', 'cong', 'bao', 'xh'].map((nh) => {
    const meta = _WEB_NHOM[nh];
    const ds = NOVA_WEB_NEN_TANG.filter((p) => p.nhom === nh);
    const soBat = ds.filter((p) => b[p.id]).length;
    const o = ds.map((p) => {
      const on = !!b[p.id];
      const s = tt[p.id] || {};
      /* Chấm nói TÌNH TRẠNG ĐÃ ĐO, không phải dự đoán:
           xanh lá = thử ra kết quả · cam = thiếu khoá API
           đỏ = thử rồi, không ra gì · rỗng = chưa kiểm
         Bậc nguồn (có API riêng hay phải nhờ công cụ tìm) lùi vào tooltip.  */
      const bac = (p.api || p.may) ? 'có API tìm riêng'
                : (p.timTrang ? 'đọc được ô tìm của trang' : 'phải nhờ công cụ tìm kiếm');
      const D = s.dangChay
        ? { m: 'var(--teal)', v: '', n: 'đang kiểm…' }
        : (s.tt === 'ok'   ? { m: 'var(--green)', v: '', n: `chạy tốt — ra ${s.so} ứng viên lúc ${_webGioChu(s.luc)}` }
        : (s.tt === 'khoa' ? { m: 'var(--amber)', v: '', n: 'cần cắm khoá API — Cài đặt → Tìm Media' }
        : (s.tt === 'ko'   ? { m: 'var(--red)',   v: '', n: `không ra kết quả lúc ${_webGioChu(s.luc)}${s.loi ? ' — ' + s.loi : ''}` }
                           : { m: 'transparent', v: '1.5px solid var(--border-bright)', n: 'chưa kiểm' })));
      return `<button type="button" onclick="webToggle('${p.id}')"
        title="${esc(p.ten)} · ${esc(p.site)}\n${D.n}\n${bac}"
        onmouseover="this.style.background='var(--surface-3)'"
        onmouseout="this.style.background='${on ? 'var(--surface-3)' : 'transparent'}'"
        style="display:flex;align-items:center;gap:8px;text-align:left;
          border:0;border-radius:7px;padding:8px 10px;font-size:12px;font-family:inherit;
          font-weight:${on ? '650' : '500'};cursor:pointer;transition:background .12s;
          background:${on ? 'var(--surface-3)' : 'transparent'};
          color:${on ? 'var(--text)' : 'var(--text-dim)'}">
        <span style="width:8px;height:8px;flex:0 0 8px;border-radius:50%;background:${D.m};${D.v ? 'border:' + D.v + ';' : ''}${s.dangChay ? 'animation:webNhay 1s infinite;' : ''}"></span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.ten)}</span>
        ${s.tt === 'khoa' ? '<span style="font-size:9.5px;color:var(--text-dim);font-weight:600">khoá</span>' : ''}
      </button>`;
    }).join('');
    const day = soBat === ds.length, rong = soBat === 0;
    return `<section style="margin-bottom:6px">
      <div style="display:flex;align-items:center;gap:9px;padding:6px 4px 7px;border-bottom:1px solid var(--border)">
        <span style="font-size:13px">${meta.icon}</span>
        <span style="font-weight:700;font-size:12.5px;color:${meta.mau}">${meta.ten}</span>
        <span style="font-size:10.5px;color:var(--text-dim);font-variant-numeric:tabular-nums">${soBat}/${ds.length}</span>
        <span style="flex:1"></span>
        <button type="button" onclick="webToggleNhom('${nh}',${day ? 'false' : 'true'})"
          style="border:0;background:transparent;font-family:inherit;font-size:10.5px;font-weight:650;
            cursor:pointer;padding:2px 4px;color:${rong || !day ? 'var(--accent)' : 'var(--text-dim)'}">
          ${day ? 'Tắt hết' : 'Bật hết'}</button>
      </div>
      ${meta.mo ? `<div style="font-size:10.5px;color:var(--text-dim);margin:6px 10px 2px;line-height:1.55">${esc(meta.mo)}</div>` : ''}
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:3px;padding:6px 2px 12px">${o}</div>
    </section>`;
  }).join('');

  const dsBat = NOVA_WEB_NEN_TANG.filter((p) => b[p.id]);
  const tongBat = dsBat.length;
  const dem = (k) => dsBat.filter((p) => (tt[p.id] || {}).tt === k).length;
  const soOk = dem('ok'), soKhoa = dem('khoa'), soKo = dem('ko');
  const soChua = tongBat - soOk - soKhoa - soKo;
  const lucCuoi = Math.max(0, ...dsBat.map((p) => (tt[p.id] || {}).luc || 0));
  // Cảnh báo khoá chỉ còn ý nghĩa với nền tảng PHẢI nhờ công cụ tìm.
  const batPhaiTim = dsBat.filter((p) => !p.api && !p.may && !p.timTrang).length;
  const K = _webKey();
  const coKhoa = !!(K.key || (K.may === 'searxng' && K.base));
  const canChuY = batPhaiTim && !coKhoa;
  if (canChuY && !_webMoCauHinh && !document.getElementById('webMay')) _webMoCauHinh = true;   // có vấn đề thì mở sẵn
  // Đọc lựa chọn ĐANG hiện trên màn hình chứ không chỉ cái đã lưu.
  const elMay = document.getElementById('webMay');
  const mayNay = elMay ? elMay.value : K.may;
  const elBase = document.getElementById('webBase');
  const baseNay = elBase ? elBase.value : K.base;
  const elKey = document.getElementById('webKey');
  const keyNay = elKey ? elKey.value : K.key;

  const oCss = 'background:var(--surface-2);border:1px solid var(--border-2);border-radius:8px;padding:6px 9px;font-size:11.5px';
  const cauHinh = !_webMoCauHinh ? '' : `
    <div style="display:flex;gap:6px;align-items:center;margin-top:9px;flex-wrap:wrap;padding:10px;border-radius:9px;background:var(--surface-2)">
      <select id="webMay" onchange="webRenderBang()" style="${oCss};font-family:inherit">
        <option value=""${!mayNay ? ' selected' : ''}>Không dùng khoá</option>
        <option value="brave"${mayNay === 'brave' ? ' selected' : ''}>Brave Search API</option>
        <option value="searxng"${mayNay === 'searxng' ? ' selected' : ''}>SearXNG</option>
      </select>
      ${mayNay === 'searxng'
        ? `<input id="webBase" value="${esc(baseNay)}" placeholder="https://searxng-tu-dung-cua-ban" title="Máy chủ SearXNG có bật định dạng JSON. Máy chủ công cộng hầu hết tắt JSON hoặc chặn nhịp — đã đo 11 cái, không cái nào dùng được." style="${oCss};width:210px">` : ''}
      <input id="webKey" type="password" value="${esc(keyNay)}" placeholder="${mayNay === 'searxng' ? 'Khoá (bỏ trống nếu máy chủ không đòi)' : 'Khoá API'}" style="${oCss};width:190px">
      <button class="btn ghost sm" style="font-size:11px;padding:5px 10px" onclick="webLuuKey(document.getElementById('webMay').value,document.getElementById('webKey').value,(document.getElementById('webBase')||{}).value||'')">Lưu</button>
      <button class="btn ghost sm" id="webThuBtn" style="font-size:11px;padding:5px 10px;border-color:var(--accent);color:var(--accent)" onclick="webThuKey()" title="Gửi một truy vấn thử có site: để xem khoá chạy không, và máy tìm có tôn trọng bộ lọc site: không">⚡ Thử</button>
      <div id="webThuKQ" style="flex:1 0 100%;font-size:10.5px;margin-top:3px;line-height:1.5"></div>
    </div>`;

  const oCham = (mau, vien, so) =>
    `<span style="display:inline-flex;align-items:center;gap:5px">
       <span style="width:8px;height:8px;border-radius:50%;background:${mau};${vien ? 'border:' + vien + ';' : ''}"></span>
       <b style="color:var(--text)">${so}</b></span>`;

  // Nhịp nháy cho chấm "đang kiểm" — chèn một lần, style thẻ nằm trong modal.
  const nhay = `<style>@keyframes webNhay{50%{opacity:.25}}</style>`;
  m.innerHTML = nhay + `<div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;
      width:min(960px,96vw);max-height:88vh;display:flex;flex-direction:column;overflow:hidden" onclick="event.stopPropagation()">
    <div style="padding:15px 18px 12px;border-bottom:1px solid var(--border);flex:0 0 auto">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:15px;font-weight:750">🌐 Nguồn web</span>
        <span style="font-size:12px;color:var(--text-dim)">${tongBat}/${NOVA_WEB_NEN_TANG.length} nền tảng đang bật</span>
        <span style="flex:1"></span>
        <button type="button" onclick="webToggleCauHinh()"
          title="Khoá cho công cụ tìm kiếm (Brave / SearXNG)"
          style="border:1px solid ${canChuY ? 'var(--amber)' : 'var(--border-2)'};background:transparent;font-family:inherit;
            border-radius:8px;padding:4px 10px;font-size:11px;font-weight:650;cursor:pointer;
            color:${canChuY ? 'var(--amber)' : (coKhoa ? 'var(--teal)' : 'var(--text-muted)')}">
          ${canChuY ? '⚠️ Cần khoá tìm kiếm' : (coKhoa ? '✓ Đã có khoá tìm kiếm' : 'Khoá tìm kiếm')}</button>
        <button type="button" onclick="webKiemTra()" title="Chạy thử một truy vấn qua từng nền tảng đang bật để biết cái nào ra kết quả thật. Nhóm phải nhờ công cụ tìm có phanh nhịp 5 giây nên lần đầu hơi lâu."
          style="border:1px solid var(--accent);background:transparent;color:var(--accent);font-family:inherit;
            border-radius:8px;padding:4px 11px;font-size:11px;font-weight:650;cursor:pointer">
          ${_webDangKiem ? '■ Dừng kiểm' : '⚡ Kiểm tra' + (lucCuoi ? ' lại' : ' tất cả')}</button>
        <button class="btn ghost sm" onclick="webDongBang()">Đóng</button>
      </div>
      <div style="display:flex;gap:15px;align-items:center;font-size:11px;color:var(--text-muted);margin-top:9px;flex-wrap:wrap">
        ${oCham('var(--green)', '', soOk)} chạy tốt
        ${soKhoa ? oCham('var(--amber)', '', soKhoa) + ' cần khoá' : ''}
        ${oCham('var(--red)', '', soKo)} không ra kết quả
        ${oCham('transparent', '1.5px solid var(--border-bright)', soChua)} chưa kiểm
        ${lucCuoi ? `<span style="color:var(--text-dim)">· kiểm lúc ${_webGioChu(lucCuoi)}</span>` : ''}
      </div>
      ${_webCanhBao ? `<div style="font-size:11px;color:var(--amber);margin-top:8px;line-height:1.55;padding:8px 10px;border-radius:8px;background:var(--surface-2)">⚠️ ${esc(_webCanhBao)}</div>` : ''}
      ${canChuY ? `<div style="font-size:10.5px;color:var(--amber);margin-top:7px;line-height:1.5">⚠️ ${batPhaiTim} nền tảng vạch xám hiện hay KHÔNG ra kết quả — Bing/DuckDuckGo chặn nhịp. Cắm khoá Brave hoặc SearXNG ở nút trên.</div>` : ''}
      ${cauHinh}
    </div>
    <div style="padding:12px 14px;overflow:auto;flex:1 1 auto">${nhomHtml}</div>
    <div style="padding:10px 18px;border-top:1px solid var(--border);flex:0 0 auto;font-size:10.5px;color:var(--text-dim);line-height:1.55">
      Tải về dùng yt-dlp có sẵn trong app nên nền tảng nào yt-dlp đọc được là lấy được clip; ứng viên nào
      yt-dlp không đọc nổi thì bị loại ngay từ lúc tìm. Ứng viên từ nhóm báo đài / mạng xã hội có nhãn ⚠️ trên thẻ để bạn tự quyết.
    </div>
  </div>`;
}

/* ══ PHANH NHỊP CHO TÌM WEB ══════════════════════════════════════════════════
   DuckDuckGo khoá IP sau khoảng 100 truy vấn liên tiếp (đã đo: sau đó mọi
   truy vấn trả 403). Nên: cách nhau tối thiểu 5 giây, trần 40 lượt mỗi phiên,
   và nhớ kết quả cũ để cùng một truy vấn không gọi lại lần hai.              */
const _WEB_NHIP = { cach: 5000, tran: 40, lanCuoi: 0, daDung: 0, chan: false, chan_ddg: false, chan_bing: false };
const _webNho = new Map();

function _webNhoKey(platId, q) { return platId + ' :: ' + String(q).toLowerCase().trim(); }

/* Phanh nhịp phải CHỊU ĐƯỢC gọi song song. Bản cũ đọc lanCuoi rồi mới ghi,
   hai luồng vào cùng lúc sẽ cùng thấy "đã đủ 5s" và cùng bắn — mất tác dụng
   phanh. Nối đuôi bằng một chuỗi promise: luồng sau chờ luồng trước xong.   */
let _webNhipHang = Promise.resolve();
function _webChoNhip() {
  const ket = _webNhipHang.then(async () => {
    const cho = _WEB_NHIP.cach - (Date.now() - _WEB_NHIP.lanCuoi);
    if (cho > 0) await new Promise((r) => setTimeout(r, cho));
    _WEB_NHIP.lanCuoi = Date.now();
  });
  _webNhipHang = ket.catch(() => {});   // một lỗi không được làm kẹt cả hàng
  return ket;
}

function webTrangThaiNhip() {
  return { daDung: _WEB_NHIP.daDung, tran: _WEB_NHIP.tran, chan: _WEB_NHIP.chan };
}
function webResetNhip() { _WEB_NHIP.daDung = 0; _WEB_NHIP.chan = false; _WEB_NHIP.chan_ddg = false; _WEB_NHIP.chan_bing = false; }

/* ══ CẦU NỐI SANG MAIN ════════════════════════════════════════════════════════ */
const _webNative = () => (window.native && window.native.nguonWeb) || null;

async function _webGet(url, opts) {
  const n = _webNative();
  if (!n) return { ok: false, error: 'chỉ chạy trong app Nova' };
  try { return await n.get(Object.assign({ url }, opts || {})); }
  catch (e) { return { ok: false, error: String((e && e.message) || e).slice(0, 90) }; }
}
async function _webJson(url, opts) {
  const r = await _webGet(url, opts);
  if (!r || !r.ok) throw new Error((r && (r.error || ('HTTP ' + r.status))) || 'lỗi mạng');
  try { return JSON.parse(r.text); } catch (_) { throw new Error('không đọc được JSON'); }
}

/* ══ API TÌM RIÊNG TỪNG NỀN TẢNG ═════════════════════════════════════════════
   Năm đường này đã đo chạy thật, không cần key, không bị chặn nhịp.          */
const _WEB_API = {
  // Archive.org — kho tư liệu công lớn nhất, có sẵn API tìm nâng cao.
  async archive(q, n) {
    const truy = q + ' AND mediatype:(movies)';
    const d = await _webJson('https://archive.org/advancedsearch.php?output=json&rows=' + n
      + '&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=licenseurl&fl%5B%5D=creator&fl%5B%5D=runtime'
      + '&q=' + encodeURIComponent(truy));
    // runtime của Archive.org là chuỗi "0:15:23" chứ không phải số giây.
    const doiGiay = (v) => {
      const p = String(v || '').trim().split(':').map(Number);
      if (!p.length || p.some((n) => !Number.isFinite(n))) return 0;
      return p.reduce((a, n) => a * 60 + n, 0);
    };
    return (((d || {}).response || {}).docs || []).map((x) => ({
      url: 'https://archive.org/details/' + x.identifier,
      ten: String(x.title || x.identifier),
      anh: 'https://archive.org/services/img/' + x.identifier,
      giay: doiGiay(Array.isArray(x.runtime) ? x.runtime[0] : x.runtime),
      giayPhep: String(x.licenseurl || 'Public domain').replace('https://creativecommons.org/', 'CC ').replace(/\/$/, ''),
      tacGia: String(x.creator || ''),
    }));
  },
  // Wikimedia Commons — lọc thẳng file video, giấy phép ghi trong extmetadata.
  async wikimedia(q, n) {
    const d = await _webJson('https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*'
      + '&generator=search&gsrsearch=' + encodeURIComponent(q + ' filetype:video')
      + '&gsrnamespace=6&gsrlimit=' + n + '&prop=imageinfo&iiprop=url|extmetadata|size&iiurlwidth=640');
    return Object.values((((d || {}).query) || {}).pages || {}).map((p) => {
      const ii = (p.imageinfo || [])[0] || {};
      const m = ii.extmetadata || {};
      const bo = (v) => String((v || {}).value || '').replace(/<[^>]*>/g, '').trim();
      if (!ii.url) return null;
      return {
        url: 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(p.title),
        ten: String(p.title || '').replace(/^File:/i, ''),
        anh: ii.thumburl || '',
        giay: Math.round(Number(ii.duration) || 0),
        giayPhep: bo(m.LicenseShortName) || 'CC',
        tacGia: bo(m.Artist).slice(0, 60),
        taiThang: ii.url,   // Commons cho tải thẳng file gốc
      };
    }).filter(Boolean);
  },
  // Dailymotion — API công khai, không cần key.
  async dailymotion(q, n) {
    const d = await _webJson('https://api.dailymotion.com/videos?limit=' + n
      + '&fields=id,title,duration,thumbnail_360_url,url,owner.screenname&search=' + encodeURIComponent(q));
    return ((d || {}).list || []).map((x) => ({
      url: String(x.url || ('https://www.dailymotion.com/video/' + x.id)),
      ten: String(x.title || ''),
      anh: String(x.thumbnail_360_url || ''),
      giay: Number(x.duration) || 0,
      giayPhep: '', tacGia: String(x['owner.screenname'] || ''),
    }));
  },
  // PeerTube — SepiaSearch tìm liên thông toàn bộ mạng PeerTube, không key.
  async peertube(q, n) {
    const d = await _webJson('https://sepiasearch.org/api/v1/search/videos?count=' + n
      + '&search=' + encodeURIComponent(q));
    return ((d || {}).data || []).map((x) => {
      const goc = String(x.url || '');
      const chu = (x.account || {}).host || '';
      return {
        url: goc,
        ten: String(x.name || ''),
        anh: x.thumbnailUrl || (chu && x.thumbnailPath ? 'https://' + chu + x.thumbnailPath : ''),
        giay: Number(x.duration) || 0,
        giayPhep: String(((x.licence || {}).label) || ''),
        tacGia: String(((x.account || {}).displayName) || ''),
      };
    }).filter((x) => x.url);
  },
  // YouTube — không có API miễn phí không key, nhưng ytsearch của yt-dlp thì có.
  async ytdlp(q, n) {
    const nt = _webNative();
    if (!nt) return [];
    const r = await nt.search({ q, n });
    if (!r || !r.ok) throw new Error(r && r.error ? r.error : 'yt-dlp lỗi');
    return (r.items || []).map((x) => ({ url: x.url, ten: x.ten, anh: x.anh, giay: x.giay, giayPhep: '', tacGia: '' }));
  },
};

/* ══ TÌM WEB (lùi về khi nền tảng không có API) ═══════════════════════════════ */
function _ddgGo(u) {
  try {
    const p = new URL(String(u), 'https://duckduckgo.com');
    if (p.pathname === '/l/' && p.searchParams.get('uddg')) return decodeURIComponent(p.searchParams.get('uddg'));
    return p.toString();
  } catch (_) { return String(u); }
}
/* Bing giờ bọc MỌI kết quả trong bing.com/ck/a?u=a1<base64url>. Bộ trích xuất
   bên test tool chỉ đọc href thô nên trả về 0 — đây là chỗ sửa.              */
function _bingGo(u) {
  try {
    const p = new URL(String(u).replace(/&amp;/g, '&'));
    let v = p.searchParams.get('u') || '';
    if (!v) return '';
    if (/^a1/i.test(v)) v = v.slice(2);
    const bin = atob(v.replace(/-/g, '+').replace(/_/g, '/'));
    const by = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const s = new TextDecoder('utf-8').decode(by);
    return /^https?:\/\//i.test(s) ? s : '';
  } catch (_) { return ''; }
}

function _webTruyVan(q, plat) {
  const p = _webById(plat);
  const base = String(q || '').replace(/\s+/g, ' ').trim();
  if (!base || !p) return base;
  return p.site ? base + ' site:' + p.site : base;
}
/* Bộ lọc site: KHÔNG đáng tin — đã đo trên chính SearXNG của người dùng:
     "city street site:vimeo.com"  → 0 URL   ·  "vimeo city street"  → 20 URL
     "city street site:flickr.com" → 20 URL  ·  "flickr city street" → 0 URL
   Cùng một máy tìm mà hai dạng cho kết quả ngược nhau, tuỳ engine phía sau có
   tôn trọng site: hay không. Nên thử CẢ HAI dạng rồi gộp, thay vì tin một dạng
   rồi kết luận nền tảng chết.                                                */
function _webTruyVanPhu(q, plat) {
  const p = _webById(plat);
  const base = String(q || '').replace(/\s+/g, ' ').trim();
  if (!base || !p) return '';
  const ten = String(p.ten || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim();
  return ten ? ten + ' ' + base : '';
}

/* ── Khoá API tìm kiếm (tuỳ chọn) ──────────────────────────────────────────
   44/55 nền tảng không có API tìm riêng. Đã đo: Bing HTML BỎ QUA bộ lọc site:
   (24 link giải mã được, 0 link đúng trang), DuckDuckGo trả 202 chặn mềm. Nên
   muốn nhóm đó ra kết quả đều thì phải có một API tìm kiếm thật. Không có key
   vẫn chạy, chỉ là nhóm ấy hay trắng tay.
   Tiền tố 'api_' để bootstrap ở đầu index.html ghi ra file, thoát app không mất. */
function _webKey() {
  try {
    return {
      may: localStorage.getItem('api_websearch_may') || '',
      key: localStorage.getItem('api_websearch_key') || '',
      base: localStorage.getItem('api_websearch_base') || '',
    };
  } catch (_) { return { may: '', key: '', base: '' }; }
}
/* Thử khoá ngay tại chỗ. Dán khoá xong mà không biết đúng sai thì đến lúc dựng
   video mới phát hiện — đúng cái đã vướng với key Pexels lần trước.
   Truy vấn thử có site: để kiểm luôn thứ quan trọng nhất: máy tìm này CÓ tôn
   trọng bộ lọc site: không (Bing thì không, nên nhóm ○ mới trắng).           */
let _webThuDang = false;
async function webThuKey() {
  if (_webThuDang) return;
  const may = (document.getElementById('webMay') || {}).value || '';
  const key = (document.getElementById('webKey') || {}).value || '';
  const base = (document.getElementById('webBase') || {}).value || '';
  const o = document.getElementById('webThuKQ');
  const bao = (txt, mau) => { if (o) o.innerHTML = `<span style="color:${mau}">${txt}</span>`; };
  if (!may) { bao('Chọn máy tìm trước đã.', 'var(--amber)'); return; }
  if (may === 'brave' && !key) { bao('Chưa dán khoá.', 'var(--amber)'); return; }
  if (may === 'searxng' && !base) { bao('Chưa nhập địa chỉ máy chủ SearXNG.', 'var(--amber)'); return; }

  _webThuDang = true;
  bao('⏳ Đang thử…', 'var(--text-dim)');
  const btn = document.getElementById('webThuBtn');
  if (btn) btn.disabled = true;
  const truy = 'documentary site:archive.org';
  try {
    const urls = (may === 'brave') ? await _webBrave(truy, 5, key) : await _webSearxng(truy, 5, base, key);
    const dung = urls.filter((u) => /(^|\/\/|\.)archive\.org\//i.test(String(u)));
    const hong = (urls._hong || []);
    const vi = hong.length ? ' Máy tìm hỏng: ' + hong.join(', ') + '.' : '';
    if (!urls.length) {
      bao(may === 'searxng'
        ? `⚠️ Kết nối được máy chủ nhưng không máy tìm nào trả kết quả.${vi || ' (máy chủ không nói lý do)'}`
        : '⚠️ Khoá chạy nhưng không trả kết quả nào.', 'var(--amber)');
    } else if (!dung.length) {
      bao(`⚠️ Trả ${urls.length} kết quả nhưng KHÔNG cái nào đúng site: — máy tìm bỏ qua bộ lọc, nhóm ○ vẫn sẽ trắng.${vi}`, 'var(--amber)');
    } else {
      bao(`✓ Chạy tốt — ${dung.length}/${urls.length} kết quả đúng bộ lọc site:. Nhóm ○ dùng được.${vi}`, 'var(--teal)');
    }
  } catch (e) {
    const ma = String((e && e.ma) || '');
    const m = String((e && e.message) || e);
    // Hai máy tìm hỏng theo kiểu hoàn toàn khác nhau nên tách hẳn nhánh. Trộn
    // chung là 429 của SearXNG bị gán nhãn "vượt hạn mức" của Brave — sai chỗ
    // để đi sửa (một bên là hết quota mình mua, một bên là máy chủ chặn bot).
    let goi;
    if (may === 'brave') {
      // Brave có hai dạng thân lỗi: một dạng có error.code, một dạng chỉ có
      // error.detail. Soi cả hai, không thì khoá sai lại hiện nguyên câu tiếng Anh.
      goi = (/SUBSCRIPTION_TOKEN_INVALID/i.test(ma) || /subscription token is invalid/i.test(m)) ? 'khoá sai hoặc chưa kích hoạt'
        : /VALIDATION/i.test(ma) ? 'khoá trống hoặc sai định dạng'
        : (/RATE_LIMIT|QUOTA/i.test(ma) || e.http === 429) ? 'vượt hạn mức của gói, chờ rồi thử lại'
        : /PLAN|SUBSCRIPTION_EXPIRED/i.test(ma) ? 'gói hiện tại không cho dùng web search'
        : (m || 'không rõ lỗi').slice(0, 80);
    } else {
      goi = /KHONG_BAT_JSON/.test(ma) ? 'máy chủ TẮT API JSON — phải thêm "json" vào search.formats trong settings.yml rồi khởi động lại'
        : e.http === 429 ? 'máy chủ chặn nhịp (429) — máy chủ công cộng gần như luôn chặn gọi tự động, phải tự dựng riêng'
        : e.http === 403 ? 'máy chủ từ chối (403) — chặn bot, hoặc cần khoá mà chưa dán'
        : e.http === 401 ? 'máy chủ đòi khoá xác thực — dán khoá vào ô bên cạnh'
        : e.http === 404 ? 'sai địa chỉ — phải là gốc máy chủ, ví dụ https://searx.vidu.com (đừng kèm /search)'
        : (m || 'không kết nối được').slice(0, 80);
    }
    bao('✗ ' + goi, 'var(--red,#e5484d)');
  } finally {
    _webThuDang = false;
    if (btn) btn.disabled = false;
  }
}

function webLuuKey(may, key, base) {
  try {
    localStorage.setItem('api_websearch_may', String(may || ''));
    localStorage.setItem('api_websearch_key', String(key || ''));
    localStorage.setItem('api_websearch_base', String(base || ''));
  } catch (_) {}
  webRenderBang();
}

// Brave Search API — có bậc miễn phí, tôn trọng site:, trả JSON sạch.
async function _webBrave(truy, n, key) {
  const r = await _webGet('https://api.search.brave.com/res/v1/web/search?count=' + Math.min(20, n * 4)
    + '&q=' + encodeURIComponent(truy), { timeoutMs: 15000, headers: { 'X-Subscription-Token': key, accept: 'application/json' } });
  if (!r || !r.ok) {
    // Brave trả 422 cho MỌI lỗi khoá, không phải 401 — đoán theo mã HTTP là gán
    // sai nhãn (đã dính: khoá bịa bị báo thành "gói không hỗ trợ"). Mã thật nằm
    // trong thân phản hồi.
    let ma = '', chiTiet = '';
    try { const e = (JSON.parse(r.text || '{}') || {}).error || {}; ma = String(e.code || ''); chiTiet = String(e.detail || ''); } catch (_) {}
    const e = new Error(chiTiet || (r && r.error) || ('HTTP ' + (r && r.status)));
    e.ma = ma; e.http = r && r.status;
    throw e;
  }
  const d = JSON.parse(r.text);
  return (((d || {}).web || {}).results || []).map((x) => String(x.url || '')).filter(Boolean);
}
// SearXNG — đúng backend mà folder test tool dùng; ai tự dựng hoặc có key thì cắm vào.
async function _webSearxng(truy, n, base, key) {
  const u = String(base).replace(/\/+$/, '') + '/search?format=json&q=' + encodeURIComponent(truy);
  const r = await _webGet(u, { timeoutMs: 15000, headers: key ? { authorization: 'Bearer ' + key, accept: 'application/json' } : { accept: 'application/json' } });
  if (!r || !r.ok) {
    const e = new Error((r && (r.error || ('HTTP ' + r.status))) || 'SearXNG lỗi');
    e.http = r && r.status;
    throw e;
  }
  // Máy chủ SearXNG mặc định TẮT định dạng JSON — nó trả trang HTML kèm HTTP 200.
  // Đo 11 máy chủ công cộng: không cái nào bật JSON và mở cho gọi từ ngoài.
  // Không bắt riêng thì người dùng nhận nguyên câu "Unexpected token '<'".
  let d = null;
  try { d = JSON.parse(r.text); }
  catch (_) {
    const e = new Error('máy chủ trả HTML, không phải JSON');
    e.ma = 'KHONG_BAT_JSON';
    throw e;
  }
  // SearXNG kèm sẵn danh sách máy tìm hỏng kèm lý do (CAPTCHA, too many
  // requests…). Đây là thứ giá trị nhất để chẩn đoán, đừng vứt đi.
  const hong = (Array.isArray(d && d.unresponsive_engines) ? d.unresponsive_engines : [])
    .map((x) => (Array.isArray(x) ? x.join('=') : String(x))).filter(Boolean);
  const ra = (Array.isArray(d && d.results) ? d.results : []).map((x) => String(x.url || '')).filter(Boolean);
  ra._hong = hong;
  return ra;
}

/* ── Ô tìm kiếm của chính trang đó ─────────────────────────────────────────
   Chỉ bật cho nền tảng đã ĐO là đọc được link từ HTML thô (arte.tv,
   democracynow.org). Phần lớn trang khác dựng kết quả bằng JS phía client nên
   HTML thô rỗng không, hoặc chặn bot thẳng — thêm vào chỉ tổ chậm.          */
async function _webTimTrang(p, q, n) {
  const t = p.timTrang;
  if (!t) return [];
  const r = await _webGet(t.url + encodeURIComponent(q), { timeoutMs: 18000 });
  if (!r || !r.ok) return [];
  const h = String(r.text || '');
  const ra = [];
  for (const m of h.matchAll(/(?:href=["']|"url":"|"@id":"|data-url=["'])([^"'<> ]+)/gi)) {
    let u = m[1].replace(/\\\//g, '/');
    if (u.startsWith('/')) u = 'https://' + t.dom + u;
    if (_webUrlHop(p.id, u) && !ra.includes(u)) ra.push(u);
    if (ra.length >= n) break;
  }
  return ra;
}

/* ── Tìm cho MỘT nền tảng không có API riêng ───────────────────────────────
   Thứ tự: API tìm kiếm có key (tốt nhất) → ô tìm của chính trang → DuckDuckGo
   → Bing. Dừng ngay khi đủ số cần, để không tiêu lượt vô ích.               */
async function _webTimQuaCongCu(platId, q, n) {
  const p = _webById(platId);
  if (!p) return [];
  const truy = _webTruyVan(q, platId);
  const ra = [];
  const them = (u) => { if (u && _webUrlHop(platId, u) && !ra.includes(u)) ra.push(u); };

  // 1) API tìm kiếm thật — không đụng phanh nhịp vì đây là dịch vụ trả tiền/tự dựng.
  const K = _webKey();
  const mayTim = async (t, soLay) => {
    if (K.key && K.may === 'brave') return await _webBrave(t, soLay, K.key);
    if (K.may === 'searxng' && K.base) return await _webSearxng(t, soLay, K.base, K.key);
    return [];
  };
  if (ra.length < n) {
    // Lấy dư (n*3) rồi mới lọc: máy tìm hay trả link chết/link không phải trang xem.
    try { (await mayTim(truy, n * 3)).forEach(them); } catch (_) {}
    // Dạng site: không ra thì thử dạng "tên-nền-tảng + từ khoá".
    if (!ra.length) {
      const phu = _webTruyVanPhu(q, platId);
      if (phu) { try { (await mayTim(phu, n * 3)).forEach(them); } catch (_) {} }
    }
  }

  // 2) Ô tìm của chính trang.
  if (ra.length < n && p.timTrang) {
    try { (await _webTimTrang(p, q, n)).forEach(them); } catch (_) {}
  }

  // 3–4) Công cụ tìm kiếm chung — chỉ tới đây mới tính phanh nhịp.
  if (ra.length < n) {
    _WEB_NHIP.chan = _WEB_NHIP.chan_ddg && _WEB_NHIP.chan_bing;   // tổng = cả hai cùng chết
    if (_WEB_NHIP.chan) { if (!ra.length) throw new Error('công cụ tìm đang chặn — cắm khoá API tìm kiếm hoặc nghỉ vài phút'); }
    else if (_WEB_NHIP.daDung >= _WEB_NHIP.tran) {
      _WEB_NHIP.chan = true;
      if (!ra.length) throw new Error('đã dùng hết ' + _WEB_NHIP.tran + ' lượt tìm web của phiên này');
    } else {
      /* Trước đây cờ `chan` dùng CHUNG cho cả hai máy: DuckDuckGo bị chặn mềm
         là đặt cờ, rồi dòng đầu vòng lặp kế tiếp thấy cờ liền break — Bing
         không bao giờ chạy. Nay mỗi máy một cờ riêng.                       */
      for (const may of ['ddg', 'bing']) {
        if (ra.length >= n) break;
        if (_WEB_NHIP['chan_' + may]) continue;
        await _webChoNhip();
        _WEB_NHIP.daDung++;
        const url = may === 'ddg'
          ? 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(truy)
          : 'https://www.bing.com/search?q=' + encodeURIComponent(truy);
        const r = await _webGet(url, { timeoutMs: 15000 });
        if (!r || !r.ok) { if (r && r.status === 403) _WEB_NHIP['chan_' + may] = true; continue; }
        // DuckDuckGo chặn mềm bằng 202 + trang rỗng, không phải 403 — phải bắt cả kiểu này.
        if (may === 'ddg' && (r.status === 202 || String(r.text || '').length < 20000)) { _WEB_NHIP.chan_ddg = true; continue; }
        const h = String(r.text || '');
        if (may === 'ddg') {
          for (const m of h.matchAll(/href=["']([^"'<> ]+)["']/gi)) them(_ddgGo(m[1]));
        } else {
          for (const m of h.matchAll(/href="(https?:\/\/www\.bing\.com\/ck\/a[^"]+)"/gi)) them(_bingGo(m[1]));
          for (const m of h.matchAll(/href="(https?:\/\/(?!www\.bing\.com|r\.bing\.com|go\.microsoft)[^"<> ]+)"/gi)) them(m[1]);
        }
      }
    }
  }

  // Các đường trên chỉ trả URL trần: không tiêu đề, không ảnh, không thời lượng.
  // yt-dlp đọc được ~1800 trang nên hỏi nó là ra đủ — và cái nào nó không đọc
  // được thì tải cũng hỏng, loại luôn ở đây còn hơn để người dùng bấm mới biết.
  /* Máy tìm hay trả video đã bị xoá/khoá vùng (đã đo trên YouTube: link đầu
     SearXNG trả về báo "Video unavailable" trong khi YouTube vẫn chạy tốt).
     Nên hỏi yt-dlp nhiều link hơn số cần, ai đọc được thì giữ — một vài link
     chết không được phép làm cả nền tảng bị coi là hỏng.                     */
  const nt = _webNative();
  const giu = ra.slice(0, Math.max(n, Math.min(n * 3, 12)));
  if (!giu.length) return [];
  if (!nt) return giu.map((u) => ({ url: u, ten: u, anh: '', giay: 0, giayPhep: '', tacGia: '' }));
  const tt = await Promise.all(giu.map((u) => nt.info({ url: u, timeoutMs: 30000 }).catch(() => null)));
  return giu.map((u, i) => {
    const t = tt[i];
    if (!t || !t.ok) return null;
    return { url: u, ten: t.ten || u, anh: t.anh || '', giay: t.giay || 0, giayPhep: t.giayPhep || '', tacGia: t.tacGia || '' };
  }).filter(Boolean).slice(0, n);
}

/* ══ TÌM TRÊN CÁC NGUỒN WEB ĐANG BẬT ═════════════════════════════════════════
   Trả ứng viên đúng hình dạng ứng viên stock để cắm thẳng vào bảng chọn có
   sẵn: { kind, downloadUrl, source, duration, thumb, license, author }.
   Khác một điểm: downloadUrl ở đây là URL TRANG, không phải file media — nên
   có cờ 'web:true' để đường tải biết phải đi qua yt-dlp.                     */
async function searchWebSources(query, opts) {
  const o = opts || {};
  const q = String(query || '').trim();
  if (!q) return { items: [], loi: [] };
  /* Pexels/Pixabay/Unsplash/NASA/Openverse do máy stock & kho lo (searchAllSources
     bên index.html), KHÔNG đi đường này — lọt vào đây là gọi _WEB_API['stock']
     không tồn tại rồi ném lỗi giả vào danh sách lỗi.                          */
  const ds = ((Array.isArray(o.platIds) && o.platIds.length)
    ? o.platIds.map(_webById).filter(Boolean)
    : _webDangBat()).filter((p) => p.may !== 'stock' && p.may !== 'kho');
  if (!ds.length) return { items: [], loi: ['chưa bật nền tảng nào'] };

  const moiNen = Math.max(2, Math.min(8, Number(o.moiNen) || 4));
  const items = [];
  const loi = [];

  // API riêng chạy song song (nhanh, không đụng phanh nhịp);
  // nhóm phải tìm web thì chạy tuần tự vì có phanh.
  const coApi = ds.filter((p) => p.api);
  const khongApi = ds.filter((p) => !p.api);

  const gom = (p, arr) => {
    (arr || []).forEach((x) => {
      if (!x || !x.url) return;
      items.push({
        kind: 'video',
        downloadUrl: x.taiThang || x.url,
        trangUrl: x.url,
        web: true,
        platId: p.id,
        source: 'web:' + p.id,
        nhom: p.nhom,
        duration: Number(x.giay) || 0,
        thumb: x.anh || '',
        license: _webGoEntity(x.giayPhep),
        author: _webGoEntity(x.tacGia),
        ten: _webGoEntity(x.ten),
        // Không CHẶN ở đây: bạn đã cố ý bật nhóm nền tảng có bản quyền, chặn
        // riêng mấy nguồn trung thực khai báo NC là ngược đời. Gắn cờ để lượt
        // tự động bỏ qua, còn chọn tay thì vẫn thấy kèm nhãn đỏ.
        camTM: _webGpCam(x.giayPhep),
      });
    });
  };

  const nho = (p, arr) => { _webNho.set(_webNhoKey(p.id, q), arr); return arr; };
  const lay = (p) => _webNho.get(_webNhoKey(p.id, q));

  await Promise.all(coApi.map(async (p) => {
    const cu = lay(p);
    if (cu) { gom(p, cu); return; }
    try { gom(p, nho(p, await _WEB_API[p.api](q, moiNen))); }
    catch (e) { loi.push(p.ten + ': ' + String((e && e.message) || e).slice(0, 40)); }
  }));

  /* Nhóm ○ phải chạy TUẦN TỰ vì có phanh nhịp. Bật cả 43 nền tảng mà chạy hết
     là 43 × 2 lượt × 5 giây > 7 phút cho MỘT cảnh, và hết sạch hạn mức 40 lượt
     ngay ở nền tảng thứ hai mươi. Nên chặn trần theo việc có khoá hay không:
     có khoá thì gọi API trả tiền, không đụng phanh, đi được nhiều; không khoá
     thì mỗi lượt đều tốn 5 giây mà xác suất ra kết quả thấp — đi ít thôi.
     Bỏ bớt bao nhiêu thì NÓI RA, không cắt lặng.                             */
  const coKhoaTim = (() => { const K = _webKey(); return !!(K.key || (K.may === 'searxng' && K.base)); })();
  const tranO = coKhoaTim ? 15 : 3;

  /* Đo được: tầng ● cho 15 ứng viên trong ~1 giây, tầng ◐/○ thêm 5 ứng viên mà
     tốn 64 giây (phần lớn là yt-dlp đọc thông tin từng URL trần). Với video vài
     trăm cảnh thì tỉ lệ đó không dùng được. Nên tầng chậm chỉ chạy khi tầng
     nhanh CHƯA ĐỦ để chọn — hoặc khi người dùng bấm "Tìm thêm" (o.day).      */
  const DU = Math.max(6, moiNen * 2);
  if (!o.day && items.length >= DU) {
    if (khongApi.length) loi.push(`đã đủ ${items.length} ứng viên từ nguồn nhanh — bỏ qua ${khongApi.length} nền tảng chậm (bấm 🔎 Tìm thêm nếu muốn quét cả nhóm đó)`);
    khongApi.length = 0;
  }
  // Nền tảng ◐ (đọc được ô tìm của chính trang) không tốn phanh nhịp → luôn thử.
  const uuTien = khongApi.filter((p) => p.timTrang);
  const conLai = khongApi.filter((p) => !p.timTrang);
  const chay = uuTien.concat(conLai.slice(0, tranO));
  const boQua = khongApi.length - chay.length;

  for (const p of chay) {
    if (o.dungLai && o.dungLai()) break;
    const cu = lay(p);
    if (cu) { gom(p, cu); continue; }
    try { gom(p, nho(p, await _webTimQuaCongCu(p.id, q, moiNen))); }
    catch (e) {
      loi.push(p.ten + ': ' + String((e && e.message) || e).slice(0, 40));
      if (_WEB_NHIP.chan) { loi.push('… dừng tìm web, các nền tảng còn lại bỏ qua'); break; }
    }
  }
  if (boQua > 0) loi.push(`bỏ qua ${boQua} nền tảng nhóm ○ cho lượt này (trần ${tranO}${coKhoaTim ? '' : ' vì chưa cắm khoá API tìm kiếm'})`);

  // Trộn XEN KẼ theo nền tảng để đầu danh sách không phải toàn một nơi.
  const theoNen = new Map();
  items.forEach((x) => { if (!theoNen.has(x.platId)) theoNen.set(x.platId, []); theoNen.get(x.platId).push(x); });
  const tron = [];
  const dai = Math.max(0, ...[...theoNen.values()].map((a) => a.length));
  for (let i = 0; i < dai; i++) for (const a of theoNen.values()) if (a[i]) tron.push(a[i]);

  return { items: tron, loi };
}

/* ══ LẤY CLIP CHO MỘT CẢNH ═══════════════════════════════════════════════════
   Ứng viên web là URL trang → phải qua yt-dlp mới thành file. Cắt luôn đúng
   số giây của cảnh rồi trả data URL, giống hệt đường clip YouTube đang chạy,
   nên xem trước và xuất video không phải sửa gì.                             */
async function webLayClip(cand, giay) {
  const nt = _webNative();
  if (!nt) return { ok: false, error: 'chỉ chạy trong app Nova' };
  if (!window.native || typeof window.native.readFileB64 !== 'function') return { ok: false, error: 'thiếu cầu đọc file' };
  const url = (cand && (cand.trangUrl || cand.downloadUrl)) || '';
  if (!url) return { ok: false, error: 'ứng viên không có URL' };
  const dur = Math.max(1.5, Number(giay) || 4);
  // Bỏ qua đoạn mở đầu: tư liệu dài hay có logo/intro ở đầu, cắt từ giây 0 là dính.
  const start = (Number(cand.duration) > dur * 3) ? Math.floor(Number(cand.duration) * 0.15) : 0;
  const r = await nt.clip({ url, dur, start });
  if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'tải clip lỗi' };
  const b = await window.native.readFileB64(r.path);
  if (!b || !b.dataUrl) return { ok: false, error: 'không đọc được clip đã tải' };
  return { ok: true, dataUrl: b.dataUrl, path: r.path, duration: dur };
}

// Nhãn nguồn cho thẻ ứng viên (⚠️ với nhóm có bản quyền).
function webNhan(platId) {
  const p = _webById(platId);
  if (!p) return '🌐 web';
  return (p.nhom === 'cong' ? '🏛 ' : '⚠️ ') + p.ten;
}

try {
  window.NOVA_WEB_NEN_TANG = NOVA_WEB_NEN_TANG;
  window.searchWebSources = searchWebSources;
  window.webLayClip = webLayClip;
  window.webNhan = webNhan;
  window._webGpCam = _webGpCam;
  window.webMoBang = webMoBang;
  window.webDongBang = webDongBang;
  window.webRenderBang = webRenderBang;
  window.webToggle = webToggle;
  window.webToggleNhom = webToggleNhom;
  window.webToggleCauHinh = webToggleCauHinh;
  window.webKiemTra = webKiemTra;
  window.webLuuKey = webLuuKey;
  window.webThuKey = webThuKey;
  window.webTrangThaiNhip = webTrangThaiNhip;
  window.webResetNhip = webResetNhip;
  window._webDangBat = _webDangBat;
  window._webUrlHop = _webUrlHop;
  window._webNhanDang = _webNhanDang;
} catch (_) {}
