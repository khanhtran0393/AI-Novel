import json
import os
import glob

def find_page_tsx():
    pattern = r'C:\Users\Khanh\.gemini\antigravity\brain\*\.system_generated\logs\transcript.jsonl'
    files = glob.glob(pattern)
    
    found = False
    for f in files:
        with open(f, 'r', encoding='utf-8') as file:
            for line_num, line in enumerate(file):
                try:
                    if 'export default function Workspace' in line and len(line) > 50000:
                        step = json.loads(line)
                        if step.get('type') == 'USER_INPUT':
                            content = step.get('content', '')
                            if len(content) > 50000:
                                print(f"BINGO! Found in USER_INPUT in {f} at line {line_num} with size {len(content)}")
                                with open(r'd:\chuyen gia mac the app\scratch\recovered_from_user.txt', 'w', encoding='utf-8') as out:
                                    out.write(content)
                                print("Saved to scratch/recovered_from_user.txt")
                                found = True
                except Exception as e:
                    pass
                    
    if not found:
        print("Not found in any USER_INPUT.")

if __name__ == "__main__":
    find_page_tsx()
