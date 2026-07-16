/**
 * Resolve exact NVIDIA driver download for a scanned GPU name.
 *
 * Flow:
 *  1) Normalize WMIC / nvidia-smi name → series + model key
 *  2) Map → { psid, pfid } (NVIDIA Advanced Driver Search IDs)
 *  3) Live lookup: gfwsl.geforce.com AjaxDriverService (DriverManualLookup)
 *  4) Return DownloadURL + details page + processFind fallback
 *
 * NVENC = inside display driver (not a separate "NVENC installer").
 */

export type NvidiaProductIds = {
  /** Product Series ID */
  psid: number;
  /** Product Family / product ID */
  pfid: number;
  /** Human series label */
  seriesLabel: string;
  /** Normalized product label used for matching */
  productLabel: string;
  /** desktop | notebook | unknown */
  formFactor: 'desktop' | 'notebook' | 'unknown';
  /** Architecture hint for support messaging */
  arch: 'pascal' | 'turing' | 'ampere' | 'ada' | 'blackwell' | 'maxwell' | 'kepler' | 'other';
};

export type NvidiaDriverLookupResult = {
  ok: boolean;
  gpuNameInput: string;
  gpuNameNormalized: string;
  matched: NvidiaProductIds | null;
  /** Direct .exe from NVIDIA CDN when API succeeds */
  downloadUrl: string | null;
  /** Driver details page */
  detailsUrl: string | null;
  /** Advanced search pre-filled */
  processFindUrl: string | null;
  version: string | null;
  releaseName: string | null;
  fileSize: string | null;
  isLegacyBranch: boolean;
  message: string;
  error: string | null;
  fromCache: boolean;
  lookedUpAt: string;
};

const OS_ID_WIN10_64 = 57;
const LANG_EN_US = 1033;

/** Cache live API results 6h per psid+pfid */
const lookupCache = new Map<string, { at: number; result: NvidiaDriverLookupResult }>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Known GeForce / RTX product IDs (community + NVIDIA processFind).
 * Patterns matched against normalized GPU name (uppercase, no NVIDIA prefix).
 * Order: first match wins — put more specific (Ti / SUPER) before base.
 */
const PRODUCT_TABLE: Array<{
  test: RegExp;
  psid: number;
  pfid: number;
  seriesLabel: string;
  productLabel: string;
  formFactor?: 'desktop' | 'notebook';
  arch: NvidiaProductIds['arch'];
}> = [
  // ── RTX 50 (Blackwell) desktop ─────────────────────────────────────────
  { test: /\bRTX\s*5090\b/, psid: 131, pfid: 1020, seriesLabel: 'GeForce RTX 50 Series', productLabel: 'GeForce RTX 5090', arch: 'blackwell' },
  { test: /\bRTX\s*5080\b/, psid: 131, pfid: 1019, seriesLabel: 'GeForce RTX 50 Series', productLabel: 'GeForce RTX 5080', arch: 'blackwell' },
  { test: /\bRTX\s*5070\s*TI\b/, psid: 131, pfid: 1018, seriesLabel: 'GeForce RTX 50 Series', productLabel: 'GeForce RTX 5070 Ti', arch: 'blackwell' },
  { test: /\bRTX\s*5070\b/, psid: 131, pfid: 1017, seriesLabel: 'GeForce RTX 50 Series', productLabel: 'GeForce RTX 5070', arch: 'blackwell' },
  { test: /\bRTX\s*5060\s*TI\b/, psid: 131, pfid: 1016, seriesLabel: 'GeForce RTX 50 Series', productLabel: 'GeForce RTX 5060 Ti', arch: 'blackwell' },
  { test: /\bRTX\s*5060\b/, psid: 131, pfid: 1015, seriesLabel: 'GeForce RTX 50 Series', productLabel: 'GeForce RTX 5060', arch: 'blackwell' },

  // ── RTX 40 (Ada) ───────────────────────────────────────────────────────
  { test: /\bRTX\s*4090\b/, psid: 129, pfid: 985, seriesLabel: 'GeForce RTX 40 Series', productLabel: 'GeForce RTX 4090', arch: 'ada' },
  { test: /\bRTX\s*4080\s*SUPER\b/, psid: 129, pfid: 1002, seriesLabel: 'GeForce RTX 40 Series', productLabel: 'GeForce RTX 4080 SUPER', arch: 'ada' },
  { test: /\bRTX\s*4080\b/, psid: 129, pfid: 986, seriesLabel: 'GeForce RTX 40 Series', productLabel: 'GeForce RTX 4080', arch: 'ada' },
  { test: /\bRTX\s*4070\s*TI\s*SUPER\b/, psid: 129, pfid: 1001, seriesLabel: 'GeForce RTX 40 Series', productLabel: 'GeForce RTX 4070 Ti SUPER', arch: 'ada' },
  { test: /\bRTX\s*4070\s*TI\b/, psid: 129, pfid: 987, seriesLabel: 'GeForce RTX 40 Series', productLabel: 'GeForce RTX 4070 Ti', arch: 'ada' },
  { test: /\bRTX\s*4070\s*SUPER\b/, psid: 129, pfid: 1000, seriesLabel: 'GeForce RTX 40 Series', productLabel: 'GeForce RTX 4070 SUPER', arch: 'ada' },
  { test: /\bRTX\s*4070\b/, psid: 129, pfid: 988, seriesLabel: 'GeForce RTX 40 Series', productLabel: 'GeForce RTX 4070', arch: 'ada' },
  { test: /\bRTX\s*4060\s*TI\b/, psid: 129, pfid: 989, seriesLabel: 'GeForce RTX 40 Series', productLabel: 'GeForce RTX 4060 Ti', arch: 'ada' },
  { test: /\bRTX\s*4060\b/, psid: 129, pfid: 990, seriesLabel: 'GeForce RTX 40 Series', productLabel: 'GeForce RTX 4060', arch: 'ada' },
  { test: /\bRTX\s*4050\b/, psid: 129, pfid: 991, seriesLabel: 'GeForce RTX 40 Series', productLabel: 'GeForce RTX 4050', arch: 'ada' },

  // ── RTX 30 (Ampere) ────────────────────────────────────────────────────
  { test: /\bRTX\s*3090\s*TI\b/, psid: 120, pfid: 935, seriesLabel: 'GeForce RTX 30 Series', productLabel: 'GeForce RTX 3090 Ti', arch: 'ampere' },
  { test: /\bRTX\s*3090\b/, psid: 120, pfid: 930, seriesLabel: 'GeForce RTX 30 Series', productLabel: 'GeForce RTX 3090', arch: 'ampere' },
  { test: /\bRTX\s*3080\s*TI\b/, psid: 120, pfid: 931, seriesLabel: 'GeForce RTX 30 Series', productLabel: 'GeForce RTX 3080 Ti', arch: 'ampere' },
  { test: /\bRTX\s*3080\b/, psid: 120, pfid: 929, seriesLabel: 'GeForce RTX 30 Series', productLabel: 'GeForce RTX 3080', arch: 'ampere' },
  { test: /\bRTX\s*3070\s*TI\b/, psid: 120, pfid: 932, seriesLabel: 'GeForce RTX 30 Series', productLabel: 'GeForce RTX 3070 Ti', arch: 'ampere' },
  { test: /\bRTX\s*3070\b/, psid: 120, pfid: 928, seriesLabel: 'GeForce RTX 30 Series', productLabel: 'GeForce RTX 3070', arch: 'ampere' },
  { test: /\bRTX\s*3060\s*TI\b/, psid: 120, pfid: 927, seriesLabel: 'GeForce RTX 30 Series', productLabel: 'GeForce RTX 3060 Ti', arch: 'ampere' },
  { test: /\bRTX\s*3060\b/, psid: 120, pfid: 926, seriesLabel: 'GeForce RTX 30 Series', productLabel: 'GeForce RTX 3060', arch: 'ampere' },
  { test: /\bRTX\s*3050\b/, psid: 120, pfid: 925, seriesLabel: 'GeForce RTX 30 Series', productLabel: 'GeForce RTX 3050', arch: 'ampere' },

  // ── RTX 20 (Turing) ────────────────────────────────────────────────────
  { test: /\bRTX\s*2080\s*TI\b/, psid: 107, pfid: 758, seriesLabel: 'GeForce RTX 20 Series', productLabel: 'GeForce RTX 2080 Ti', arch: 'turing' },
  { test: /\bRTX\s*2080\s*SUPER\b/, psid: 107, pfid: 857, seriesLabel: 'GeForce RTX 20 Series', productLabel: 'GeForce RTX 2080 SUPER', arch: 'turing' },
  { test: /\bRTX\s*2080\b/, psid: 107, pfid: 757, seriesLabel: 'GeForce RTX 20 Series', productLabel: 'GeForce RTX 2080', arch: 'turing' },
  { test: /\bRTX\s*2070\s*SUPER\b/, psid: 107, pfid: 856, seriesLabel: 'GeForce RTX 20 Series', productLabel: 'GeForce RTX 2070 SUPER', arch: 'turing' },
  { test: /\bRTX\s*2070\b/, psid: 107, pfid: 756, seriesLabel: 'GeForce RTX 20 Series', productLabel: 'GeForce RTX 2070', arch: 'turing' },
  { test: /\bRTX\s*2060\s*SUPER\b/, psid: 107, pfid: 855, seriesLabel: 'GeForce RTX 20 Series', productLabel: 'GeForce RTX 2060 SUPER', arch: 'turing' },
  { test: /\bRTX\s*2060\b/, psid: 107, pfid: 755, seriesLabel: 'GeForce RTX 20 Series', productLabel: 'GeForce RTX 2060', arch: 'turing' },

  // ── GTX 16 (Turing) ────────────────────────────────────────────────────
  { test: /\bGTX\s*1660\s*TI\b/, psid: 112, pfid: 872, seriesLabel: 'GeForce 16 Series', productLabel: 'GeForce GTX 1660 Ti', arch: 'turing' },
  { test: /\bGTX\s*1660\s*SUPER\b/, psid: 112, pfid: 882, seriesLabel: 'GeForce 16 Series', productLabel: 'GeForce GTX 1660 SUPER', arch: 'turing' },
  { test: /\bGTX\s*1660\b/, psid: 112, pfid: 871, seriesLabel: 'GeForce 16 Series', productLabel: 'GeForce GTX 1660', arch: 'turing' },
  { test: /\bGTX\s*1650\s*SUPER\b/, psid: 112, pfid: 881, seriesLabel: 'GeForce 16 Series', productLabel: 'GeForce GTX 1650 SUPER', arch: 'turing' },
  { test: /\bGTX\s*1650\b/, psid: 112, pfid: 870, seriesLabel: 'GeForce 16 Series', productLabel: 'GeForce GTX 1650', arch: 'turing' },

  // ── GTX 10 (Pascal) — legacy branch ~580.x ─────────────────────────────
  // Validated: psid=101, pfid 756–758 return driver matrix including 1050 Ti
  { test: /\bGTX\s*1080\s*TI\b/, psid: 101, pfid: 845, seriesLabel: 'GeForce 10 Series', productLabel: 'GeForce GTX 1080 Ti', arch: 'pascal' },
  { test: /\bGTX\s*1080\b/, psid: 101, pfid: 729, seriesLabel: 'GeForce 10 Series', productLabel: 'GeForce GTX 1080', arch: 'pascal' },
  { test: /\bGTX\s*1070\s*TI\b/, psid: 101, pfid: 807, seriesLabel: 'GeForce 10 Series', productLabel: 'GeForce GTX 1070 Ti', arch: 'pascal' },
  { test: /\bGTX\s*1070\b/, psid: 101, pfid: 728, seriesLabel: 'GeForce 10 Series', productLabel: 'GeForce GTX 1070', arch: 'pascal' },
  { test: /\bGTX\s*1060\b/, psid: 101, pfid: 730, seriesLabel: 'GeForce 10 Series', productLabel: 'GeForce GTX 1060', arch: 'pascal' },
  { test: /\bGTX\s*1050\s*TI\b/, psid: 101, pfid: 758, seriesLabel: 'GeForce 10 Series', productLabel: 'GeForce GTX 1050 Ti', arch: 'pascal' },
  { test: /\bGTX\s*1050\b/, psid: 101, pfid: 757, seriesLabel: 'GeForce 10 Series', productLabel: 'GeForce GTX 1050', arch: 'pascal' },
  { test: /\bGTX\s*1030\b/, psid: 101, pfid: 827, seriesLabel: 'GeForce 10 Series', productLabel: 'GeForce GT 1030', arch: 'pascal' },

  // ── GTX 9 (Maxwell) ────────────────────────────────────────────────────
  { test: /\bGTX\s*980\s*TI\b/, psid: 73, pfid: 693, seriesLabel: 'GeForce 900 Series', productLabel: 'GeForce GTX 980 Ti', arch: 'maxwell' },
  { test: /\bGTX\s*980\b/, psid: 73, pfid: 670, seriesLabel: 'GeForce 900 Series', productLabel: 'GeForce GTX 980', arch: 'maxwell' },
  { test: /\bGTX\s*970\b/, psid: 73, pfid: 669, seriesLabel: 'GeForce 900 Series', productLabel: 'GeForce GTX 970', arch: 'maxwell' },
  { test: /\bGTX\s*960\b/, psid: 73, pfid: 668, seriesLabel: 'GeForce 900 Series', productLabel: 'GeForce GTX 960', arch: 'maxwell' },
  { test: /\bGTX\s*950\b/, psid: 73, pfid: 714, seriesLabel: 'GeForce 900 Series', productLabel: 'GeForce GTX 950', arch: 'maxwell' },
];

export function normalizeGpuName(raw: string): string {
  return String(raw || '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchNvidiaProduct(gpuName: string): NvidiaProductIds | null {
  const n = normalizeGpuName(gpuName);
  if (!n || !/nvidia|geforce|rtx|gtx|quadro|titan/i.test(n)) return null;

  const upper = n.toUpperCase();
  const notebook =
    /\b(LAPTOP|NOTEBOOK|MOBILE|MAX-?Q|GO\b)/i.test(n) || /\bM\s*$/.test(upper);
  const formFactor: NvidiaProductIds['formFactor'] = notebook ? 'notebook' : 'desktop';

  for (const row of PRODUCT_TABLE) {
    if (row.test.test(upper)) {
      return {
        psid: row.psid,
        pfid: row.pfid,
        seriesLabel: row.seriesLabel,
        productLabel: row.productLabel,
        formFactor: row.formFactor || formFactor,
        arch: row.arch,
      };
    }
  }

  // Series-only fallback (weaker pfid = first of series)
  if (/\bRTX\s*5\d{2}/.test(upper)) {
    return {
      psid: 131,
      pfid: 1015,
      seriesLabel: 'GeForce RTX 50 Series',
      productLabel: n,
      formFactor,
      arch: 'blackwell',
    };
  }
  if (/\bRTX\s*4\d{2}/.test(upper)) {
    return {
      psid: 129,
      pfid: 990,
      seriesLabel: 'GeForce RTX 40 Series',
      productLabel: n,
      formFactor,
      arch: 'ada',
    };
  }
  if (/\bRTX\s*3\d{2}/.test(upper)) {
    return {
      psid: 120,
      pfid: 926,
      seriesLabel: 'GeForce RTX 30 Series',
      productLabel: n,
      formFactor,
      arch: 'ampere',
    };
  }
  if (/\bRTX\s*2\d{2}/.test(upper)) {
    return {
      psid: 107,
      pfid: 755,
      seriesLabel: 'GeForce RTX 20 Series',
      productLabel: n,
      formFactor,
      arch: 'turing',
    };
  }
  if (/\bGTX\s*16\d{2}/.test(upper)) {
    return {
      psid: 112,
      pfid: 870,
      seriesLabel: 'GeForce 16 Series',
      productLabel: n,
      formFactor,
      arch: 'turing',
    };
  }
  if (/\bGTX\s*10\d{2}/.test(upper)) {
    return {
      psid: 101,
      pfid: 758,
      seriesLabel: 'GeForce 10 Series',
      productLabel: n,
      formFactor,
      arch: 'pascal',
    };
  }

  return null;
}

function processFindUrl(psid: number, pfid: number): string {
  // dtcid=1 = DCH (modern Windows)
  return (
    `https://www.nvidia.com/Download/processFind.aspx?psid=${psid}&pfid=${pfid}` +
    `&osid=${OS_ID_WIN10_64}&lid=1&whql=1&ctk=0&dtcid=1&lang=en-us`
  );
}

function decodeUriLoose(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function preferDesktopPackage(url: string, formFactor: NvidiaProductIds['formFactor']): string {
  if (!url) return url;
  if (formFactor === 'desktop' && /notebook/i.test(url)) {
    return url.replace(/-notebook-/i, '-desktop-');
  }
  if (formFactor === 'notebook' && /desktop/i.test(url) && !/win10-win11/.test(url)) {
    return url.replace(/-desktop-/i, '-notebook-');
  }
  return url;
}

type AjaxIds = {
  downloadInfo?: {
    Success?: string;
    Version?: string;
    Name?: string;
    NameLocalized?: string;
    DownloadURL?: string;
    DetailsURL?: string;
    DownloadURLFileSize?: string;
  };
};

/**
 * Live NVIDIA GFE Ajax lookup — returns latest WHQL DCH driver for psid/pfid.
 */
export async function fetchNvidiaDriverAjax(
  psid: number,
  pfid: number,
): Promise<{
  ok: boolean;
  version: string | null;
  downloadUrl: string | null;
  detailsUrl: string | null;
  fileSize: string | null;
  releaseName: string | null;
  rawError: string | null;
}> {
  const url =
    'https://gfwsl.geforce.com/services_toolkit/services/com/nvidia/services/AjaxDriverService.php' +
    `?func=DriverManualLookup&psid=${psid}&pfid=${pfid}` +
    `&osID=${OS_ID_WIN10_64}&languageCode=${LANG_EN_US}` +
    '&isWHQL=1&dch=1&sort1=0&numberOfResults=1';

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      // Next.js node: no cache for live versions
      cache: 'no-store',
    });
    if (!res.ok) {
      return {
        ok: false,
        version: null,
        downloadUrl: null,
        detailsUrl: null,
        fileSize: null,
        releaseName: null,
        rawError: `HTTP ${res.status}`,
      };
    }
    const text = await res.text();
    let data: { Success?: string; IDS?: AjaxIds[] };
    try {
      data = JSON.parse(text);
    } catch {
      return {
        ok: false,
        version: null,
        downloadUrl: null,
        detailsUrl: null,
        fileSize: null,
        releaseName: null,
        rawError: 'JSON parse failed',
      };
    }
    if (String(data.Success) !== '1' || !data.IDS?.[0]?.downloadInfo) {
      return {
        ok: false,
        version: null,
        downloadUrl: null,
        detailsUrl: null,
        fileSize: null,
        releaseName: null,
        rawError: 'No driver matrix result',
      };
    }
    const info = data.IDS[0].downloadInfo;
    if (String(info.Success) !== '1' || !info.DownloadURL) {
      return {
        ok: false,
        version: null,
        downloadUrl: null,
        detailsUrl: null,
        fileSize: null,
        releaseName: null,
        rawError: 'downloadInfo empty',
      };
    }
    return {
      ok: true,
      version: info.Version || null,
      downloadUrl: decodeUriLoose(info.DownloadURL),
      detailsUrl: info.DetailsURL ? decodeUriLoose(info.DetailsURL) : null,
      fileSize: info.DownloadURLFileSize || null,
      releaseName: decodeUriLoose(info.NameLocalized || info.Name || ''),
      rawError: null,
    };
  } catch (e) {
    return {
      ok: false,
      version: null,
      downloadUrl: null,
      detailsUrl: null,
      fileSize: null,
      releaseName: null,
      rawError: e instanceof Error ? e.message : String(e),
    };
  }
}

function isLegacyArch(arch: NvidiaProductIds['arch']): boolean {
  return arch === 'pascal' || arch === 'maxwell' || arch === 'kepler';
}

/**
 * Full resolve: match GPU name → live download URL for that product matrix.
 */
export async function resolveNvidiaDriverForGpu(
  gpuName: string,
  opts?: { force?: boolean },
): Promise<NvidiaDriverLookupResult> {
  const gpuNameInput = String(gpuName || '');
  const gpuNameNormalized = normalizeGpuName(gpuNameInput);
  const lookedUpAt = new Date().toISOString();

  const matched = matchNvidiaProduct(gpuNameNormalized);
  if (!matched) {
    return {
      ok: false,
      gpuNameInput,
      gpuNameNormalized,
      matched: null,
      downloadUrl: null,
      detailsUrl: null,
      processFindUrl: null,
      version: null,
      releaseName: null,
      fileSize: null,
      isLegacyBranch: false,
      message:
        'Không map được model NVIDIA. Dùng Find Drivers thủ công hoặc NVIDIA App.',
      error: 'no_product_match',
      fromCache: false,
      lookedUpAt,
    };
  }

  const cacheKey = `${matched.psid}:${matched.pfid}:${matched.formFactor}`;
  if (!opts?.force) {
    const hit = lookupCache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return { ...hit.result, fromCache: true, gpuNameInput, gpuNameNormalized };
    }
  }

  const ajax = await fetchNvidiaDriverAjax(matched.psid, matched.pfid);
  const pfUrl = processFindUrl(matched.psid, matched.pfid);
  const legacy = isLegacyArch(matched.arch);

  if (!ajax.ok || !ajax.downloadUrl) {
    const result: NvidiaDriverLookupResult = {
      ok: false,
      gpuNameInput,
      gpuNameNormalized,
      matched,
      downloadUrl: null,
      detailsUrl: ajax.detailsUrl,
      processFindUrl: pfUrl,
      version: null,
      releaseName: null,
      fileSize: null,
      isLegacyBranch: legacy,
      message:
        `Đã nhận diện ${matched.productLabel} (${matched.seriesLabel}) nhưng API NVIDIA không trả file. ` +
        `Mở processFind / NVIDIA App. ${ajax.rawError || ''}`.trim(),
      error: ajax.rawError || 'ajax_fail',
      fromCache: false,
      lookedUpAt,
    };
    lookupCache.set(cacheKey, { at: Date.now(), result });
    return result;
  }

  let downloadUrl = preferDesktopPackage(ajax.downloadUrl, matched.formFactor);
  // Prefer international desktop WHQL package when notebook CDN returned for desktop GPU
  if (
    matched.formFactor === 'desktop' &&
    ajax.version &&
    /notebook/i.test(downloadUrl)
  ) {
    const v = ajax.version;
    downloadUrl = `https://us.download.nvidia.com/Windows/${v}/${v}-desktop-win10-win11-64bit-international-dch-whql.exe`;
  }

  const legacyNote = legacy
    ? ` Card ${matched.arch.toUpperCase()} (vd. GTX 10xx) dùng nhánh legacy (~580.x), không còn Game Ready 610+. ` +
      `Vẫn nên cài bản security mới nhất cho NVENC. Nếu FFmpeg báo API mismatch: dùng libx264 hoặc FFmpeg cũ hơn.`
    : '';

  const result: NvidiaDriverLookupResult = {
    ok: true,
    gpuNameInput,
    gpuNameNormalized,
    matched,
    downloadUrl,
    detailsUrl: ajax.detailsUrl,
    processFindUrl: pfUrl,
    version: ajax.version,
    releaseName: ajax.releaseName,
    fileSize: ajax.fileSize,
    isLegacyBranch: legacy,
    message:
      `Driver cho ${matched.productLabel}: v${ajax.version || '?'}` +
      (ajax.fileSize ? ` · ${ajax.fileSize}` : '') +
      `.` +
      legacyNote,
    error: null,
    fromCache: false,
    lookedUpAt,
  };

  lookupCache.set(cacheKey, { at: Date.now(), result });
  return result;
}

export function clearNvidiaDriverLookupCache(): void {
  lookupCache.clear();
}
