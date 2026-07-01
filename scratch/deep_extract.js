// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const readline = require('readline');

async function extract() {
  const logFile = 'C:\\Users\\Khanh\\.gemini\\antigravity\\brain\\6961ece0-84d7-4f5d-a2e0-21a4097fb7b6\\.system_generated\\logs\\transcript.jsonl';
  const fileStream = fs.createReadStream(logFile);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  
  let bestContent = '';
  let stepIndex = 0;
  
  for await (const line of rl) {
    stepIndex++;
    try {
      const step = JSON.parse(line);
      if (step.tool_calls) {
        for (const call of step.tool_calls) {
          if (call.name === 'write_to_file' && call.args && call.args.TargetFile && call.args.TargetFile.endsWith('page.tsx')) {
            if (call.args.CodeContent && call.args.CodeContent.length > bestContent.length) {
              bestContent = call.args.CodeContent;
              console.log(`Step ${stepIndex}: Found write_to_file size ${bestContent.length}`);
            }
          }
        }
      }
      
      // Also check tool responses for view_file! If we viewed the file, maybe it has the content? (view_file only returns up to 800 lines though)
      // We know `multi_replace_file_content` modifies the file. 
      // But maybe we can find a `write_to_file` of `recovered_source.js` or `page.tsx`.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {}
  }
  
  if (bestContent.length > 50000) {
    fs.writeFileSync('d:\\chuyen gia mac the app\\src\\app\\workspace\\page.tsx', bestContent, 'utf8');
    console.log(`SUCCESS! Recovered file of size ${bestContent.length}`);
  } else {
    console.log(`Failed. Best size was only ${bestContent.length}`);
  }
}

extract();
