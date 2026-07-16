import { NextResponse } from 'next/server';
import os from 'os';
import { getBridgeSnapshotAsync } from '@/lib/flow-bridge/bridgeServer';
import { execSync } from 'child_process';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const bridge = await getBridgeSnapshotAsync();
    
    let chromeRamBytes = 0;
    let chromePids = 0;
    
    if (process.platform === 'win32') {
      try {
        // Find chrome.exe, chromium.exe, msedge.exe
        const out = execSync('tasklist /FI "IMAGENAME eq chrome.exe" /FO CSV /NH', { encoding: 'utf8', windowsHide: true, timeout: 2000 });
        const lines = out.trim().split('\n');
        for (const line of lines) {
           if (line.includes('chrome.exe')) {
             chromePids++;
             const parts = line.split('","');
             if (parts.length >= 5) {
               const kbString = parts[4].replace(/[^\d]/g, '');
               if (kbString) {
                 chromeRamBytes += parseInt(kbString, 10) * 1024;
               }
             }
           }
        }
      } catch (e) {
        /* ignore */
      }
    }

    return NextResponse.json({
      ok: true,
      ram: {
        total: totalMem,
        free: freeMem,
        used: totalMem - freeMem,
      },
      chrome: {
        pids: chromePids,
        ramBytes: chromeRamBytes,
      },
      queue: {
        active: bridge.queue?.activeWorkers || 0,
        // snapshot has activeWorkers only; cap parallel slots from defaults (3)
        max: Math.max(1, bridge.queue?.activeWorkers || 0, 3),
      }
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
