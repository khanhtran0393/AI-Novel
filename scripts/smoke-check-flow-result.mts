import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const BASE = 'http://127.0.0.1:3000';

async function main() {
  console.log('=== CHECKING FLOW QUEUE & VIDEO OUTPUT ===');
  const res = await fetch(`${BASE}/api/flow/status`);
  const data = await res.json();
  
  const queueTasks = data?.queue?.tasks || [];
  console.log(`Queue total tasks: ${queueTasks.length}`);
  
  for (const task of queueTasks.slice(-5)) {
    console.log(`\nTask ID: ${task.id}`);
    console.log(`  Kind: ${task.kind}`);
    console.log(`  Status: ${task.status}`);
    console.log(`  Progress: ${task.progress}% - ${task.progressMessage}`);
    if (task.resultPaths) console.log(`  Result Paths:`, task.resultPaths);
    if (task.error) console.log(`  Error:`, task.error);
  }

  const vdir = path.join(process.cwd(), 'public', 'video');
  if (fs.existsSync(vdir)) {
    console.log('\n--- Video Files in public/video ---');
    const files = fs.readdirSync(vdir).filter(f => f.endsWith('.mp4'));
    for (const f of files) {
      const stat = fs.statSync(path.join(vdir, f));
      console.log(`- ${f} (${(stat.size / 1024 / 1024).toFixed(2)} MB, updated ${stat.mtime.toISOString()})`);
    }
  }
}

main().catch(console.error);
