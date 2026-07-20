import { AppError } from '@/lib/errors';
import {
  fetchPinnedLicenseApi,
  resolvePinnedLicenseApiUrl,
} from '@/lib/commercial/licenseTrust';

function licenseBaseUrl(): URL {
  return resolvePinnedLicenseApiUrl();
}

/** Forward a customer request to the seller license service without secrets. */
export async function proxyLicenseApiPost(
  pathname: string,
  body: Record<string, unknown>,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const endpoint = new URL(pathname, licenseBaseUrl()).toString();
  let status = 0;
  let bodyText = '';
  try {
    const res = await fetchPinnedLicenseApi(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: 15_000,
    });
    status = res.status;
    bodyText = res.bodyText;
  } catch (error) {
    throw new AppError(
      `Không kết nối được license server (pin/TLS): ${
        error instanceof Error ? error.message : String(error)
      }`,
      { code: 'INFRA', status: 503 },
    );
  }
  let payload: Record<string, unknown> = {};
  try {
    payload = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
  } catch {
    payload = { error: 'License API trả non-JSON', raw: bodyText.slice(0, 200) };
  }
  return { status, payload };
}
