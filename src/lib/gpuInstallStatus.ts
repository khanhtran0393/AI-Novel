import fs from 'fs';
import path from 'path';

export type GpuInstallStatus = {
  status: 'idle' | 'installing' | 'success' | 'failed';
  progress: number;
  message: string;
  log?: string;
  startTime?: string;
  updatedAt?: string;
  pid?: number;
  stale?: boolean;
  stalled?: boolean;
};

const DEFAULT_STALE_MS = 45 * 60 * 1000;
const DEFAULT_STALLED_MS = 5 * 60 * 1000;

export function gpuInstallStatusPath(root = process.cwd()): string {
  return path.join(root, 'python_core', 'gpu_install_status.json');
}

function ageMsFromStatus(filePath: string, raw: Partial<GpuInstallStatus>): number {
  const stamp =
    Date.parse(String(raw.updatedAt || '')) ||
    Date.parse(String(raw.startTime || '')) ||
    0;
  if (stamp > 0) return Date.now() - stamp;
  try {
    return Date.now() - fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function processAlive(pid?: number): boolean {
  if (!pid || !Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function normalizeGpuInstallStatus(
  raw: Partial<GpuInstallStatus> | null | undefined,
  root = process.cwd(),
): GpuInstallStatus {
  if (!raw || typeof raw !== 'object') {
    return { status: 'idle', progress: 0, message: 'Chua bat dau cai dat' };
  }
  const filePath = gpuInstallStatusPath(root);
  const status =
    raw.status === 'success' ||
    raw.status === 'failed' ||
    raw.status === 'installing'
      ? raw.status
      : 'idle';
  const progress = Math.max(
    0,
    Math.min(100, Number.isFinite(Number(raw.progress)) ? Number(raw.progress) : 0),
  );
  const base: GpuInstallStatus = {
    status,
    progress,
    message: String(raw.message || ''),
    log: typeof raw.log === 'string' ? raw.log : undefined,
    startTime: typeof raw.startTime === 'string' ? raw.startTime : undefined,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
    pid: Number.isFinite(Number(raw.pid)) ? Number(raw.pid) : undefined,
  };

  if (status !== 'installing') return base;

  const staleMs = Math.max(
    60_000,
    Number(process.env.AINOVEL_GPU_INSTALL_STALE_MS || DEFAULT_STALE_MS),
  );
  const stalledMs = Math.max(
    60_000,
    Number(process.env.AINOVEL_GPU_INSTALL_STALLED_MS || DEFAULT_STALLED_MS),
  );
  const ageMs = ageMsFromStatus(filePath, base);
  const alive = processAlive(base.pid);
  const stale = Boolean((base.pid && !alive) || (!base.pid && ageMs > stalledMs) || ageMs > staleMs);
  if (stale) {
    return {
      ...base,
      status: 'failed',
      stale: true,
      message:
        'Bo cai GPU bi ket hoac worker da dung. Bam cai lai de khoi dong job moi.',
    };
  }
  return {
    ...base,
    stalled: ageMs > stalledMs && progress <= 5,
  };
}

export function readGpuInstallStatus(root = process.cwd()): GpuInstallStatus {
  const filePath = gpuInstallStatusPath(root);
  if (!fs.existsSync(filePath)) {
    return { status: 'idle', progress: 0, message: 'Chua bat dau cai dat' };
  }
  try {
    return normalizeGpuInstallStatus(
      JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<GpuInstallStatus>,
      root,
    );
  } catch (error) {
    return {
      status: 'failed',
      progress: 0,
      message:
        error instanceof Error
          ? `Khong doc duoc status GPU: ${error.message}`
          : 'Khong doc duoc status GPU',
    };
  }
}

export function writeGpuInstallStatus(
  status: Partial<GpuInstallStatus>,
  root = process.cwd(),
): GpuInstallStatus {
  const filePath = gpuInstallStatusPath(root);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const next = {
    ...status,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2), 'utf8');
  return normalizeGpuInstallStatus(next, root);
}
