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
                    if 'tool_calls' in line:
                        step = json.loads(line)
                        for call in step.get('tool_calls', []):
                            if call.get('name') == 'write_to_file':
                                args = call.get('args', {})
                                target = args.get('TargetFile', '')
                                if target.endswith('page.tsx'):
                                    content = args.get('CodeContent', '')
                                    if len(content) > 50000:
                                        print(f"BINGO! Found in {f} at line {line_num} with size {len(content)}")
                                        with open(r'd:\chuyen gia mac the app\scratch\recovered_from_brain.tsx', 'w', encoding='utf-8') as out:
                                            out.write(content)
                                        print("Saved to scratch/recovered_from_brain.tsx")
                                        found = True
                except Exception as e:
                    pass
                    
    if not found:
        print("Not found in any write_to_file calls.")

if __name__ == "__main__":
    find_page_tsx()
