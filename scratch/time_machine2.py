import json
import os

def replay_edits():
    transcript_path = r'C:\Users\Khanh\.gemini\antigravity\brain\6961ece0-84d7-4f5d-a2e0-21a4097fb7b6\.system_generated\logs\transcript.jsonl'
    
    with open(r'd:\chuyen gia mac the app\scratch\base_page_utf8.tsx', 'r', encoding='utf-8') as f:
        content = f.read()
        
    print(f"Starting with base size: {len(content)}")
    
    success_count = 0
    fail_count = 0
    
    with open(transcript_path, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f):
            try:
                step = json.loads(line)
                if 'tool_calls' in step:
                    for call in step['tool_calls']:
                        if call.get('name') == 'write_to_file':
                            args = call.get('args', {})
                            if args.get('TargetFile', '').endswith('page.tsx'):
                                content = args.get('CodeContent', '')
                                print(f"[{line_num}] write_to_file initialized content (len: {len(content)})")
                        
                        elif call.get('name') == 'replace_file_content':
                            args = call.get('args', {})
                            if args.get('TargetFile', '').endswith('page.tsx'):
                                target = args.get('TargetContent', '')
                                replacement = args.get('ReplacementContent', '')
                                allow_multiple = args.get('AllowMultiple', False)
                                
                                if target in content:
                                    if allow_multiple:
                                        content = content.replace(target, replacement)
                                    else:
                                        content = content.replace(target, replacement, 1)
                                    success_count += 1
                                else:
                                    fail_count += 1
                        
                        elif call.get('name') == 'multi_replace_file_content':
                            args = call.get('args', {})
                            if args.get('TargetFile', '').endswith('page.tsx'):
                                chunks = args.get('ReplacementChunks', [])
                                for chunk in chunks:
                                    target = chunk.get('TargetContent', '')
                                    replacement = chunk.get('ReplacementContent', '')
                                    allow_multiple = chunk.get('AllowMultiple', False)
                                    if target in content:
                                        if allow_multiple:
                                            content = content.replace(target, replacement)
                                        else:
                                            content = content.replace(target, replacement, 1)
                                        success_count += 1
                                    else:
                                        fail_count += 1
            except Exception as e:
                pass
                
    if content:
        with open(r'd:\chuyen gia mac the app\scratch\reconstructed_page.tsx', 'w', encoding='utf-8') as out:
            out.write(content)
        print(f"\nSuccessfully reconstructed page.tsx! Final size: {len(content)} bytes.")
        print(f"Applied {success_count} edits, {fail_count} failed.")
    else:
        print("Failed to reconstruct anything.")

if __name__ == "__main__":
    replay_edits()
