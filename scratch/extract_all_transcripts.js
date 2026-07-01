// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const readline = require('readline');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');

const brainDir = 'C:\\Users\\Khanh\\.gemini\\antigravity\\brain';
const folders = fs.readdirSync(brainDir);

console.log(`Found ${folders.length} folders in brain directory.`);

const keywords = ['parseScenes', 'cleanVoiceScript', 'activeSceneIndex', 'handleExpandScene', 'getWordCount'];

async function scanFolder(folderName) {
  const logFile = path.join(brainDir, folderName, '.system_generated', 'logs', 'transcript.jsonl');
  if (!fs.existsSync(logFile)) return;

  const fileStream = fs.createReadStream(logFile);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    try {
      const step = JSON.parse(line);
      if (step.tool_calls) {
        for (const tc of step.tool_calls) {
          if (tc.name === 'replace_file_content' || tc.name === 'write_to_file') {
            const args = tc.args || {};
            const content = args.ReplacementContent || args.CodeContent || '';
            const target = args.TargetFile || '';
            
            // Check if it contains any keyword
            for (const keyword of keywords) {
              if (content.includes(keyword)) {
                console.log(`\n==================================================`);
                console.log(`MATCH FOUND in folder ${folderName}, step ${step.step_index} for keyword '${keyword}'`);
                console.log(`Tool: ${tc.name}, Target: ${target}`);
                console.log(`Description: ${args.Description || ''}`);
                console.log(`==================================================`);
                
                const dumpPath = path.join('d:\\chuyen gia mac the app\\scratch', `recovered_${keyword}_from_${folderName}_step_${step.step_index}.js`);
                fs.writeFileSync(dumpPath, content);
                console.log(`Saved full content to: ${dumpPath}`);
                break; // Only save once per tool call
              }
            }
          }
        }
      }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      // Ignore
    }
  }
}

async function run() {
  for (const folder of folders) {
    await scanFolder(folder);
  }
  console.log('All folders scanned.');
}

run();
