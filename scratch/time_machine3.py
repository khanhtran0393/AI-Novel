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
                        name = call.get('name')
                        args = call.get('args', {})
                        target_file = args.get('TargetFile', '')
                        
                        if not isinstance(target_file, str):
                            continue
                            
                        if 'workspace/page.tsx' not in target_file.replace('\\\\', '/').replace('\\', '/'):
                            continue

                        if name == 'write_to_file':
                            content = args.get('CodeContent', '').replace('\r\n', '\n')
                            print(f"[{line_num}] write_to_file initialized content (len: {len(content)})")
                        
                        elif name == 'replace_file_content':
                            target = args.get('TargetContent', '').replace('\r\n', '\n')
                            replacement = args.get('ReplacementContent', '').replace('\r\n', '\n')
                            allow_multiple = args.get('AllowMultiple', False)
                            
                            if target in content:
                                if allow_multiple:
                                    content = content.replace(target, replacement)
                                else:
                                    content = content.replace(target, replacement, 1)
                                success_count += 1
                                print(f"[{line_num}] SUCCESS: replace_file_content")
                            else:
                                fail_count += 1
                                print(f"[{line_num}] FAIL: target not found in replace_file_content")
                        
                        elif name == 'multi_replace_file_content':
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
                                    print(f"[{line_num}] SUCCESS: multi_replace_file_content chunk")
                                else:
                                    fail_count += 1
                                    print(f"[{line_num}] FAIL: target not found in multi_replace chunk")
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
