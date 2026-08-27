# AI Video Studio — MCP Server

Cho AI agent (Claude Desktop, Codex, hay bất kỳ MCP client nào) **điều khiển năng lực dựng video native** của AI Video Studio: dựng MP4 từ ảnh + giọng đọc/nhạc/phụ đề, nâng cấp ảnh (Real-ESRGAN), xoá watermark, đo độ dài media.

## Kiến trúc

```
MCP client  ⇄ (stdio, JSON-RPC)  index.js  ⇄ (HTTP 127.0.0.1:8794)  App AI Video Studio  →  FFmpeg / Real-ESRGAN / ...
```

- `index.js` — MCP server chạy bằng `node`, **không cần cài package ngoài**.
- Nó gọi **cầu HTTP cục bộ** mà app AI Video Studio mở sẵn (`mcp-bridge-native.js`, cổng 8794).
- ⚠️ **App AI Video Studio phải đang chạy** thì các tool nặng (render/upscale/watermark) mới hoạt động. `tools/list` thì không cần.

## Công cụ (tools)

| Tool | Việc | Tham số chính |
|---|---|---|
| `ffmpeg_info` | Kiểm tra FFmpeg sẵn sàng | — |
| `probe_media` | Đo độ dài file media | `path` |
| `render_video` | Dựng MP4 từ cảnh + audio | `scenes[]`, `output`, `voiceover?`, `music?`, `subtitlesSrt?` |
| `upscale_images` | Nâng cấp ảnh Real-ESRGAN | `inputs[]`, `outputDir?`, `target?` |
| `remove_watermark` | Xoá watermark ảnh | `input`, `output?`, `folder?` |

### Ví dụ `render_video`
```json
{
  "scenes": [
    { "image": "/Users/ban/anh/canh1.png", "seconds": 4, "effect": "zoom-in", "transition": "fade" },
    { "image": "/Users/ban/anh/canh2.png", "seconds": 5, "effect": "pan-left" }
  ],
  "voiceover": "/Users/ban/audio/giong.mp3",
  "music": "/Users/ban/audio/nhac.mp3",
  "output": "/Users/ban/Desktop/video.mp4",
  "width": 1920, "height": 1080, "fps": 30
}
```

## Cài vào Claude Desktop

Sửa `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nova-studio": {
      "command": "node",
      "args": ["/Users/ban/Documents/tool/novastudio-app/mcp-server/index.js"]
    }
  }
}
```

Đổi đường dẫn cho đúng máy. Khởi động lại Claude Desktop, rồi mở app AI Video Studio là dùng được.

## Đổi cổng cầu

Mặc định `http://127.0.0.1:8794`. Ghi đè bằng biến môi trường:

```json
"env": { "NOVA_MCP_BRIDGE": "http://127.0.0.1:8794" }
```

## Kiểm thử nhanh (không cần app)

```bash
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | node index.js
```
