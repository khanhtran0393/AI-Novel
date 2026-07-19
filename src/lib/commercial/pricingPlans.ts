/**
 * Commercial VND pricing + bank transfer / VietQR config (seller: TRAN HUU KHANH).
 */

export type PaidPlanId = 'month' | 'year' | 'lifetime';

export type PaidPlan = {
  id: PaidPlanId;
  label: string;
  priceVnd: number;
  /** Short price for buttons */
  priceLabel: string;
  /** Transfer memo prefix (no HWID) */
  contentPrefix: string;
  expSeconds: number;
  plan: 'pro' | 'vip';
  highlight?: boolean;
};

/** Seller bank — Techcombank (ảnh QR #3) */
export const SELLER_BANK = {
  bankName: 'TECHCOMBANK',
  /** NAPAS BIN Techcombank */
  bin: '970407',
  accountNo: '19032706354018',
  accountName: 'TRAN HUU KHANH',
  /** Zalo admin support */
  zalo: '0868715114',
  zaloDisplay: '0868.715.114',
} as const;

export const PAID_PLANS: PaidPlan[] = [
  {
    id: 'month',
    label: 'GÓI 01 THÁNG',
    priceVnd: 478_000,
    priceLabel: '478.000đ',
    contentPrefix: 'CAP THANG',
    expSeconds: 60 * 60 * 24 * 30,
    plan: 'pro',
  },
  {
    id: 'year',
    label: 'GÓI 01 NĂM',
    priceVnd: 4_780_000,
    priceLabel: '4.780.000đ',
    contentPrefix: 'CAP NAM',
    expSeconds: 60 * 60 * 24 * 365,
    plan: 'pro',
  },
  {
    id: 'lifetime',
    label: 'GÓI TRỌN ĐỜI',
    priceVnd: 8_999_000,
    priceLabel: '8.999.000đ',
    contentPrefix: 'CAP TRON DOI',
    expSeconds: 60 * 60 * 24 * 365 * 50,
    plan: 'vip',
    highlight: true,
  },
];

export function formatVnd(n: number): string {
  return `${n.toLocaleString('vi-VN')}đ`;
}

/** Nội dung CK = prefix + HWID (uppercase, no spaces extras) */
export function buildTransferContent(planId: PaidPlanId, hwid: string): string {
  const plan = PAID_PLANS.find((p) => p.id === planId) || PAID_PLANS[2];
  const id = (hwid || 'UNKNOWN').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `${plan.contentPrefix} ${id}`.trim();
}

/**
 * VietQR image URL with dynamic amount + addInfo.
 * Fallback UI uses static /brand/qr-techcombank.jpg if img fails.
 */
export function buildVietQrImageUrl(planId: PaidPlanId, hwid: string): string {
  const plan = PAID_PLANS.find((p) => p.id === planId) || PAID_PLANS[2];
  const addInfo = encodeURIComponent(buildTransferContent(planId, hwid));
  const name = encodeURIComponent(SELLER_BANK.accountName);
  return `https://img.vietqr.io/image/${SELLER_BANK.bin}-${SELLER_BANK.accountNo}-compact2.jpg?amount=${plan.priceVnd}&addInfo=${addInfo}&accountName=${name}`;
}

export const STATIC_QR_FALLBACK = '/brand/qr-techcombank.jpg';
