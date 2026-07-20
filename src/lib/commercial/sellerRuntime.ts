import { resolveEntitlementSigningKey } from '@/lib/entitlement';
import { AppError } from '@/lib/errors';
import {
  isPackagedCustomerRuntime as multiSignalPackaged,
} from '@/lib/commercial/packagedAttestation';

/** True only inside the shipped Electron customer application (multi-signal). */
export function isPackagedCustomerRuntime(): boolean {
  return multiSignalPackaged();
}

/** Seller/admin endpoints must never be usable from an installed customer app. */
export function assertSellerRuntime(): void {
  if (isPackagedCustomerRuntime()) {
    throw new AppError('Endpoint này chỉ chạy trên seller/backend.', {
      code: 'NOT_FOUND',
      status: 404,
    });
  }
}

export function assertLicenseSignerConfigured(): void {
  const signer = resolveEntitlementSigningKey();
  if (!signer.ok) {
    throw new AppError(signer.reason || 'License signer chưa cấu hình.', {
      code: 'INFRA',
      status: 503,
    });
  }
}
