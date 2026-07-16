/**
 * Official NVIDIA links for NVENC (hardware video encode).
 *
 * NVENC is NOT a separate SDK install for end users — it ships inside the
 * GeForce / Studio / RTX display driver. Phantom-X Bypass uses FFmpeg h264_nvenc,
 * which requires a driver new enough for the bundled FFmpeg NVENC API.
 *
 * CUDA + ONNX (Settings "Tải CUDA") is for AI inference only — different stack.
 */

export const NVENC_DRIVER_LINKS = {
  /** Main driver hub (Game Ready / Studio / auto via NVIDIA App) */
  driversHub: {
    label: 'NVIDIA Drivers (chính thức)',
    url: 'https://www.nvidia.com/en-us/drivers/',
    blurb: 'Trang tải driver chính thức — Game Ready hoặc Studio.',
  },
  /** Manual product picker (card model + OS) */
  driverFinder: {
    label: 'Tìm driver theo card (Find Drivers)',
    url: 'https://www.nvidia.com/Download/index.aspx',
    blurb: 'Chọn đúng model GPU (vd. GTX 1050 Ti) + Windows 10/11.',
  },
  /** GeForce-focused downloads */
  geforceDrivers: {
    label: 'GeForce Drivers',
    url: 'https://www.nvidia.com/en-us/geforce/drivers/',
    blurb: 'Game Ready Driver — phổ biến cho card GeForce.',
  },
  /** Auto-update app (replaces GeForce Experience for many users) */
  nvidiaApp: {
    label: 'NVIDIA App (cập nhật driver tự động)',
    url: 'https://www.nvidia.com/en-us/software/nvidia-app/',
    blurb: 'Cài app → Drivers → cài bản mới nhất (khuyến nghị ≥ 610).',
  },
} as const;

export type NvencDriverLinkId = keyof typeof NVENC_DRIVER_LINKS;

/** Ordered list for UI */
export const NVENC_DRIVER_LINK_LIST = [
  NVENC_DRIVER_LINKS.nvidiaApp,
  NVENC_DRIVER_LINKS.driversHub,
  NVENC_DRIVER_LINKS.driverFinder,
  NVENC_DRIVER_LINKS.geforceDrivers,
] as const;

export const NVENC_DRIVER_HELP_VI = {
  title: 'Tải driver NVIDIA (bật NVENC cho Phantom-X Bypass)',
  body:
    'NVENC nằm trong driver card NVIDIA — không có gói “cài NVENC” riêng. ' +
    'Cập nhật Game Ready / Studio Driver (thường ≥ 610), khởi động lại PC, ' +
    'rồi Quét lại. Nút “CUDA + ONNX” chỉ cho AI local, không thay driver encode.',
  afterInstall:
    'Sau khi cài driver: khởi động lại → Cài đặt → Quét lại → badge “NVENC sẵn sàng”.',
} as const;

/** Open URL in default browser (Electron shell or window). */
export function openNvencDriverUrl(url: string): void {
  try {
    const w = typeof window !== 'undefined' ? window : null;
    // Electron may expose shell via preload; fallback to window.open
    const anyWin = w as Window & {
      electronAPI?: { openExternal?: (u: string) => void };
      require?: (m: string) => { shell?: { openExternal: (u: string) => void } };
    };
    if (anyWin?.electronAPI?.openExternal) {
      anyWin.electronAPI.openExternal(url);
      return;
    }
    w?.open(url, '_blank', 'noopener,noreferrer');
  } catch {
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }
}
