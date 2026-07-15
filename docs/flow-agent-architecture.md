# FlowAgent → AI Novel (architecture map)

Nguồn: `FlowAgent_Technical_Architecture_And_Workflow_DeepDive.md`

## 4 khối hậu trường → code AI Novel

| FlowAgent | AI Novel |
|-----------|----------|
| Queue + AsyncWorker (QThread / account) | `src/lib/flow-bridge/queueEngine.ts` — multi-worker, parallel ≤3 |
| WebSocket `ws://127.0.0.1:9222` | `bridgeServer.ts` — **9223** (+ HTTP **8101**) |
| Base64 + Prompt Injector face-lock | `promptInjector.ts` + `payloadBuilder.ts` |
| State / Retry / Slide / Token 45′ | queue retry 5× / 30s, account cooldown, token watchdog |

## 6 giai đoạn runtime

1. **Init & inject** — `bootstrap.ts` Chrome `--load-extension` + tab Flow; extension `content.js` → `injected.js`
2. **Token harvest** — extension `webRequest` Bearer `ya29` → WS → bridge
3. **Payload + face-lock** — upload ref Base64 → `mediaId` → inject English face-lock
4. **Captcha** — `solve_captcha` / `grecaptcha.enterprise` (extension)
5. **API proxy** — `api_request` aisandbox-pa + monkey-patch media URLs
6. **Download / upscale / telemetry** — save `public/images` + `image_output`, `public/video` + `veo_output`; upsample 2K/4K; extension telemetry giữ nguyên

## Face-lock (nguyên văn FlowAgent)

```
Using the uploaded image as the ONLY identity reference, preserve the exact facial identity...
```

## Defaults

- delay 5–10s, maxRetries 5, retryDelay 30s, tokenRefresh 45m
- imageProvider/videoProvider = `flow`
