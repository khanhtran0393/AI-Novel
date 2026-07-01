// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');
const filePath = path.join(__dirname, '../src/app/workspace/page.tsx');
let content = fs.readFileSync(filePath, 'utf8');

content = content.replace(/\r\n/g, '\n');

const marker = 'chapter_{store.chuong_dang_chon}_scene_{idx}_animatic.mp4';
const markerIndex = content.indexOf(marker);

if (markerIndex !== -1) {
  const tail = content.substring(markerIndex);
  const lines = tail.split('\n');
  
  let idxToReplace = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('chapter_{store.chuong_dang_chon}_scene_{idx}_animatic.mp4</span>')) {
      idxToReplace = i;
      break;
    }
  }
  
  if (idxToReplace !== -1) {
    console.log(`Found line index: ${idxToReplace}`);
    
    // Let's print out what is currently in these lines to be 100% sure:
    console.log("=== CURRENT LINES FROM INDEX + 3 ===");
    for (let k = 3; k <= 11; k++) {
      console.log(`Line ${k}: "${lines[idxToReplace + k]}"`);
    }
    
    const cleanLines = [
      '                                                </div>', // closes line 2033 (div)
      '                                              )}',      // closes line 2002 (generatedVideoPaths check)
      '                                            </div>',    // closes line 1997 (div)
      '                                          </div>',      // closes line 1957 (div)
      '                                        )}',            // closes line 1956 (promptsAsset check)
      '                                      </div>',          // closes line 1895 (div)
      '                                    )}',                // closes ternary else and ternary check
      '                                  </div>',              // closes line 1877 (div)
      '                                )}',                    // closes line 1876 (openTabInStudio check)
      '                              </div>',                  // closes line 1696 (div)
      '                            )}'                        // closes line 1695 (isExpanded check)
    ];
    
    // Splice out the 9 mismatched lines starting at idxToReplace + 3, and insert our 11 new lines
    lines.splice(idxToReplace + 3, 9, ...cleanLines);
    
    // Now rejoin lines
    const newContent = content.substring(0, markerIndex) + lines.join('\n');
    fs.writeFileSync(filePath, newContent, 'utf8');
    console.log('SUCCESS: Line-by-line replacement applied successfully!');
  } else {
    console.log('ERROR: Line index not found!');
  }
} else {
  console.log('ERROR: Marker not found!');
}
