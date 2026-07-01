import json
import sys

transcript_path = r'C:\Users\Khanh\.gemini\antigravity\brain\6961ece0-84d7-4f5d-a2e0-21a4097fb7b6\.system_generated\logs\transcript.jsonl'

lines = []
with open(transcript_path, 'r', encoding='utf-8') as f:
    for line in f:
        if '134' in line or 'checkout' in line or 'rollback' in line or '240cfa4' in line:
            lines.append(line)

print(f'Found {len(lines)} matches.')
for i, l in enumerate(lines[:30]):
    data = json.loads(l)
    print(f'Match {i}: {data.get("type", "")}')
    if data.get("type") == "TOOL_RESPONSE" and "tool_calls" in data:
        for tc in data["tool_calls"]:
            if tc.get("name") == "default_api:view_file":
                output = tc.get("output", "")
                if "134" in output or "134KB" in output:
                    print("Found file details in view_file!")
                    print(output[:300])
