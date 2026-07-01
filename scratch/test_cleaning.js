import fs from 'fs';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import path from 'path';

function cleanJsonString(raw) {
  let text = raw.trim();
  text = text.replace(/^```[a-zA-Z]*[\s\n]*/, '');
  text = text.replace(/```$/, '').trim();

  const firstCurly = text.indexOf('{');
  const lastCurly = text.lastIndexOf('}');
  const firstSquare = text.indexOf('[');
  const lastSquare = text.lastIndexOf(']');

  let jsonStr = '';
  if (firstCurly !== -1 && lastCurly !== -1 && (firstSquare === -1 || firstCurly < firstSquare)) {
    jsonStr = text.substring(firstCurly, lastCurly + 1);
  } else if (firstSquare !== -1 && lastSquare !== -1) {
    jsonStr = text.substring(firstSquare, lastSquare + 1);
  } else {
    jsonStr = text;
  }

  let result = '';
  let inString = false;
  let escape = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];

    if (inString) {
      if (escape) {
        result += char;
        escape = false;
      } else if (char === '\\') {
        result += char;
        escape = true;
      } else if (char === '"') {
        let nextChar = '';
        let lookAheadIdx = i + 1;
        while (lookAheadIdx < jsonStr.length) {
          const next = jsonStr[lookAheadIdx];
          if (next !== ' ' && next !== '\n' && next !== '\r' && next !== '\t') {
            nextChar = next;
            break;
          }
          lookAheadIdx++;
        }

        const isClosing = nextChar === ':' || nextChar === ',' || nextChar === '}' || nextChar === ']';

        if (isClosing) {
          result += char;
          inString = false;
        } else {
          result += '\\"';
        }
      } else if (char === '\n') {
        result += '\\n';
      } else if (char === '\r') {
        result += '\\r';
      } else if (char === '\t') {
        result += '\\t';
      } else {
        result += char;
      }
    } else {
      if (char === '"') {
        inString = true;
        result += char;
      } else {
        result += char;
      }
    }
  }

  return result;
}

function run() {
  const rawPath = 'scratch/raw_response.txt';
  if (!fs.existsSync(rawPath)) {
    console.error('File not found:', rawPath);
    return;
  }

  const raw = fs.readFileSync(rawPath, 'utf8');
  console.log('Original length:', raw.length);
  
  const cleaned = cleanJsonString(raw);
  console.log('Cleaned length:', cleaned.length);

  try {
    const parsed = JSON.parse(cleaned);
    console.log('✅ SUCCESS! JSON PARSED COMPLETELY!');
    console.log('Title:', parsed.tieu_de);
    console.log('Characters:', parsed.nhan_vat);
    console.log('Chapters count:', parsed.danh_sach_chuong?.length);
    console.log('Chapter 1 Title:', parsed.danh_sach_chuong?.[0]?.tieu_de);
  } catch (err) {
    console.error('❌ FAILED to parse cleaned JSON:', err.message);
    
    // Save the cleaned output to see what went wrong
    fs.writeFileSync('scratch/cleaned_failed_response.txt', cleaned);
    console.log('Saved failed cleaned string to scratch/cleaned_failed_response.txt');
  }
}

run();
