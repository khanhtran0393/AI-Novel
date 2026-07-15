import fs from 'fs';
import path from 'path';

export function findChromePath(): string | undefined {
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  if (process.env.LOCALAPPDATA) {
    paths.push(path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'));
  }
  if (process.env.USERPROFILE) {
    paths.push(
      path.join(process.env.USERPROFILE, 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
    );
  }
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}
