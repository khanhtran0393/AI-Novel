import path from 'path';

function cleanEnvPath(value: string | undefined): string {
  return String(value || '').trim();
}

export function getAppResourceRoot(cwd = process.cwd()): string {
  return cleanEnvPath(process.env.AI_NOVEL_ROOT) || cwd;
}

export function getRuntimeDataRoot(cwd = process.cwd()): string {
  return (
    cleanEnvPath(process.env.AINOVEL_RUNTIME_DATA_DIR) ||
    cleanEnvPath(process.env.AI_NOVEL_USER_DATA) ||
    cwd
  );
}

export function getRuntimeScratchRoot(cwd = process.cwd()): string {
  return path.join(getRuntimeDataRoot(cwd), 'scratch');
}

export function getRuntimePublicRoot(cwd = process.cwd()): string {
  return path.join(getRuntimeDataRoot(cwd), 'public');
}

export function getRuntimeOutputRoot(cwd = process.cwd()): string {
  return path.join(getRuntimeDataRoot(cwd), 'output');
}

export function getRuntimePublicPath(
  rel: string,
  cwd = process.cwd(),
): string {
  return path.join(getRuntimePublicRoot(cwd), rel.replace(/^[/\\]+/, ''));
}

export function getAppPublicPath(rel: string, cwd = process.cwd()): string {
  return path.join(getAppResourceRoot(cwd), 'public', rel.replace(/^[/\\]+/, ''));
}
