// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const readline = require('readline');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');

const logFile = 'C:\\Users\\Khanh\\.gemini\\antigravity\\brain\\6961ece0-84d7-4f5d-a2e0-21a4097fb7b6\\.system_generated\\logs\\transcript.jsonl';

async function extractCode() {
  if (!fs.existsSync(logFile)) {
    console.log('Log file does not exist!');
    return;
  }

  const fileStream = fs.createReadStream(logFile);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  console.log('Scanning transcript log...');
  
  for await (const line of rl) {
    try {
      const step = JSON.parse(line);
      
      // Check if there are tool calls in this step
      if (step.tool_calls) {
        for (const tc of step.tool_calls) {
          if (tc.name === 'replace_file_content' || tc.name === 'write_to_file') {
            const args = tc.args || {};
            const content = args.ReplacementContent || args.CodeContent || '';
            const target = args.TargetFile || '';
            
            // Check if it contains our functions
            if (content.includes('parseScenes') || content.includes('handleExpandScene') || content.includes('cleanVoiceScript')) {
              console.log(`\n==================================================`);
              console.log(`FOUND TOOL CALL in step_index ${step.step_index}`);
              console.log(`Type: ${tc.name}, Target: ${target}`);
              console.log(`Description: ${args.Description || ''}`);
              console.log(`==================================================`);
              
              // Write a preview to the console
              console.log(content.substring(0, 1500) + '\n... [TRUNCATED] ...\n' + content.substring(Math.max(0, content.length - 1500)));
              
              // Let's dump the full replacement content to a temporary file for inspection!
              const dumpName = `dump_step_${step.step_index}.txt`;
              fs.writeFileSync(path.join('d:\\chuyen gia mac the app\\scratch', dumpName), content);
              console.log(`Dumped FULL content to scratch/${dumpName}`);
            }
          }
        }
      }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      // Ignore parsing errors for truncated lines
    }
  }
  console.log('Finished scanning transcript log.');
}

extractCode();
