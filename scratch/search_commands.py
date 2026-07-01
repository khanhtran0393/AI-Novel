import json
import sys

transcript_path = r'C:\Users\Khanh\.gemini\antigravity\brain\6961ece0-84d7-4f5d-a2e0-21a4097fb7b6\.system_generated\logs\transcript.jsonl'
cmds = []
with open(transcript_path, 'r', encoding='utf-8') as f:
    for line in f:
        try:
            data = json.loads(line)
            if "tool_calls" in data:
                for tc in data["tool_calls"]:
                    if tc.get("name") in ["run_command", "default_api:run_command"]:
                        cmd = tc.get("args", {}).get("CommandLine", "")
                        cmds.append(cmd)
        except:
            pass

print('Last 40 commands executed in this conversation:')
for i, c in enumerate(cmds[-40:]):
    print(f"{i}: {c}")
