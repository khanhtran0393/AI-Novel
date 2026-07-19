import { NextResponse } from 'next/server';
import { supabaseConfigPublic } from '@/lib/supabase/env';
import { getEntitlementPublicStatus } from '@/lib/entitlement';
import { SELLER_BANK, PAID_PLANS } from '@/lib/commercial/pricingPlans';

export const runtime = 'nodejs';

export async function GET() {
  const sb = supabaseConfigPublic();
  const ent = getEntitlementPublicStatus();
  return NextResponse.json({
    ok: true,
    supabase: sb,
    entitlement: {
      mode: ent.mode,
      readyForCommercial: ent.readyForCommercial,
      blockers: ent.blockers,
    },
    hybrid: {
      localLicense: true,
      cloudOrders: sb.adminConfigured,
      note: sb.adminConfigured
        ? 'Cloud orders + revoke bật (service role).'
        : 'Chưa cấu hình Supabase admin — dùng license local / Zalo.',
    },
    bank: {
      name: SELLER_BANK.bankName,
      account: SELLER_BANK.accountNo,
      owner: SELLER_BANK.accountName,
      zalo: SELLER_BANK.zaloDisplay,
    },
    plans: PAID_PLANS.map((p) => ({
      id: p.id,
      label: p.label,
      priceVnd: p.priceVnd,
      priceLabel: p.priceLabel,
    })),
  });
}
