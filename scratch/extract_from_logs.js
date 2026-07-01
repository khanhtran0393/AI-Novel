// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const path = require('path');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const readline = require('readline');

async function extractFromLogs() {
  const logFile = 'C:\\Users\\Khanh\\.gemini\\antigravity\\brain\\6961ece0-84d7-4f5d-a2e0-21a4097fb7b6\\.system_generated\\logs\\transcript.jsonl';
  
  if (!fs.existsSync(logFile)) {
    console.log(`ERROR: Log file does not exist at ${logFile}`);
    return;
  }
  
  const fileStream = fs.createReadStream(logFile);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  
  let stepIndex = 0;
  for await (const line of rl) {
    try {
      const step = JSON.parse(line);
      stepIndex++;
      
      // Let's search for write_to_file or replace_file_content calls where TargetFile is page.tsx
      if (step.tool_calls) {
        for (const call of step.tool_calls) {
          if (call.name === 'write_to_file' && call.args && call.args.TargetFile && call.args.TargetFile.endsWith('page.tsx')) {
            console.log(`Found write_to_file for page.tsx at step ${stepIndex}`);
            // Check if this write contains the full recovered page (it should have size > 100KB)
            if (call.args.CodeContent && call.args.CodeContent.length > 100000) {
              console.log(`*** SUCCESS: Found pristine CodeContent of size ${call.args.CodeContent.length} bytes! ***`);
              fs.writeFileSync('d:\\chuyen gia mac the app\\src\\app\\workspace\\page.tsx', call.args.CodeContent, 'utf8');
              console.log('RESTORED PRISTINE page.tsx FROM LOGS SUCCESSFULLY!');
              return;
            }
          }
        }
      }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      // JSON parse error or similar
    }
  }
  
  console.log('Finished scanning logs, pristine content not found in write_to_file. Trying search for the content in file modifications...');
}

extractFromLogs();
