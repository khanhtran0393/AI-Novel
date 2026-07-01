import os
import re

def extract_text():
    cache_dir = r"d:\chuyen gia mac the app\.next\dev\cache\turbopack\ee6e79b1"
    
    if not os.path.exists(cache_dir):
        print(f"Directory {cache_dir} not found.")
        return

    out_file = open(r"d:\chuyen gia mac the app\scratch\all_extracted_text.txt", "w", encoding="utf-8")
    
    # Regex to find blocks of printable ASCII characters + newlines/tabs
    # At least 500 characters long to avoid noise
    printable_pattern = re.compile(b'[\\x20-\\x7E\\t\\n\\r]{500,}')
    
    count = 0
    for filename in os.listdir(cache_dir):
        if not filename.endswith('.sst'):
            continue
            
        filepath = os.path.join(cache_dir, filename)
        try:
            with open(filepath, 'rb') as f:
                content = f.read()
                
            matches = printable_pattern.findall(content)
            for match in matches:
                text = match.decode('utf-8', 'ignore')
                if 'use client' in text and 'export default function' in text:
                    out_file.write(f"\n\n--- MATCH FOUND IN {filename} ---\n\n")
                    out_file.write(text)
                    count += 1
        except Exception as e:
            pass

    out_file.close()
    print(f"Found {count} potential source code blocks. Saved to scratch/all_extracted_text.txt")

if __name__ == "__main__":
    extract_text()
