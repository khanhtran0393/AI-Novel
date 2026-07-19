/** The real TypeScript commercial smoke owns the isolated multi-seat test. */
import { spawnSync } from 'child_process';

const result = spawnSync(
  process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe',
  ['/d', '/s', '/c', 'npx.cmd tsx scripts/smoke-commercial-ts.mts'],
  {
  cwd: process.cwd(),
  encoding: 'utf8',
  shell: false,
  },
);
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('PASS smoke-multiseat');
