/** Minimal row types for commercial tables (hand-written; generate later via CLI). */

export type ProfileRole = 'customer' | 'admin';

export type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: ProfileRole;
  created_at: string;
  updated_at: string;
};

export type OrderPlan = 'month' | 'year' | 'lifetime';
export type OrderStatus = 'pending' | 'paid' | 'rejected' | 'refunded';

export type OrderRow = {
  id: string;
  user_id: string | null;
  plan: OrderPlan;
  amount_vnd: number;
  status: OrderStatus;
  transfer_content: string | null;
  hwid: string | null;
  bill_path: string | null;
  note: string | null;
  guest_email: string | null;
  created_at: string;
  paid_at: string | null;
};

export type LicensePlan = 'trial' | 'pro' | 'vip';
export type LicenseStatus = 'active' | 'revoked' | 'expired';

export type LicenseRow = {
  id: string;
  user_id: string | null;
  order_id: string | null;
  plan: LicensePlan;
  hwid: string;
  status: LicenseStatus;
  exp_at: string;
  token_hash: string | null;
  activation_code: string | null;
  created_at: string;
  revoked_at: string | null;
};
