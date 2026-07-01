import json
import os

def replay_edits():
    transcript_path = r'C:\Users\Khanh\.gemini\antigravity\brain\6961ece0-84d7-4f5d-a2e0-21a4097fb7b6\.system_generated\logs\transcript.jsonl'
    
    # We need the base file. Let's start with the one from git that is 2885 bytes!
    # Wait, the current one in git is 37344 bytes. Where is the 2885 one?
    # I will just start with an empty string, and if there is a write_to_file, I will use it.
    
    content = ""
    
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
                                    print(f"[{line_num}] Applied replace_file_content (new len: {len(content)})")
                                else:
                                    print(f"[{line_num}] FAILED replace_file_content - target not found")
                        
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
                                    else:
                                        print(f"[{line_num}] FAILED chunk in multi_replace - target not found")
                                print(f"[{line_num}] Applied multi_replace_file_content (new len: {len(content)})")
            except Exception as e:
                pass
                
    if content:
        with open(r'd:\chuyen gia mac the app\scratch\reconstructed_page.tsx', 'w', encoding='utf-8') as out:
            out.write(content)
        print(f"\nSuccessfully reconstructed page.tsx! Final size: {len(content)} bytes.")
    else:
        print("Failed to reconstruct anything.")

if __name__ == "__main__":
    replay_edits()
