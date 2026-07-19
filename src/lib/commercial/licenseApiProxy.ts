import { AppError } from '@/lib/errors';

function licenseBaseUrl(): URL {
  const raw = String(process.env.AINOVEL_LICENSE_API_URL || '').trim();
  let base: URL;
  try {
    base = new URL(raw);
  } catch {
    throw new AppError('Thiếu AINOVEL_LICENSE_API_URL hợp lệ.', {
      code: 'INFRA',
      status: 503,
    });
  }
  if (
    base.protocol !== 'https:' ||
    base.hostname === 'example.com' ||
    base.hostname.endsWith('.example.com')
  ) {
    throw new AppError('License API production phải là HTTPS thật.', {
      code: 'INFRA',
      status: 503,
    });
  }
  return base;
}

/** Forward a customer request to the seller license service without secrets. */
export async function proxyLicenseApiPost(
  pathname: string,
  body: Record<string, unknown>,
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const endpoint = new URL(pathname, licenseBaseUrl()).toString();
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new AppError(
      `Không kết nối được license server: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { code: 'INFRA', status: 503 },
    );
  }
  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  return { status: response.status, payload };
}
