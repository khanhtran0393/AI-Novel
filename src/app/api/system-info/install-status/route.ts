import { NextResponse } from 'next/server';
import { readGpuInstallStatus } from '@/lib/gpuInstallStatus';

export const runtime = 'nodejs';

export async function GET() {
  try {
    return NextResponse.json(readGpuInstallStatus());
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Loi khi doc trang thai cai dat.',
      },
      { status: 500 },
    );
  }
}
