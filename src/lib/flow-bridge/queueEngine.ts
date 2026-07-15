/**
 * FlowAgent Task Queue & Worker Threading (Node port).
 * - Shared pending queue
 * - N workers (≤ accounts, max 3) in parallel mode
 * - Human delay delay_min..delay_max between tasks
 * - Retry 5× with 30s pause; slide to free account on hard fail
 * - Face-lock inject + optional upscale 2K/4K
 */
import fs from 'fs';
import path from 'path';
import { FLOW_DEFAULTS } from './config';
import {
  pickReadyAccount,
  updateAccount,
  loadAccounts,
} from './accountStore';
import {
  buildBrowserHeaders,
  buildCheckVideoStatusBody,
  buildImageGenerateBody,
  buildUploadImageBody,
  buildUpsampleImageBody,
  buildUpsampleVideoBody,
  buildVideoI2VBody,
  extractImageResults,
  isPortraitRatio,
  extractVideoMedia,
  extractVideoOperations,
} from './payloadBuilder';
import { fileToBase64, injectFaceLockPrompt } from './promptInjector';
import type {
  FlowExecutionMode,
  FlowTask,
  FlowTaskKind,
  RetryCategory,
} from './types';

function taskId(): string {
  return `ft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function classifyError(status?: number, message?: string): RetryCategory {
  const m = (message || '').toLowerCase();
  if (status === 401 || m.includes('unauthent') || m.includes('token')) {
    return 'token_401';
  }
  if (status === 429 || m.includes('rate')) return 'rate_429';
  if (status === 403 || m.includes('forbidden') || m.includes('captcha')) {
    return 'forbidden_403';
  }
  if (m.includes('quota') || m.includes('credit') || m.includes('paygate')) {
    return 'quota';
  }
  if (m.includes('network') || m.includes('timeout') || m.includes('econn')) {
    return 'network';
  }
  if (m.includes('policy') || m.includes('safety') || m.includes('content')) {
    return 'content';
  }
  return 'other';
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
}

function resolveLocalImage(ref?: string): string | null {
  if (!ref) return null;
  let s = String(ref).trim().split('?')[0];
  if (!s) return null;
  if (path.isAbsolute(s) && fs.existsSync(s)) return s;
  const candidates = [
    path.join(process.cwd(), s),
    path.join(process.cwd(), 'public', s.replace(/^\//, '')),
    path.join(process.cwd(), 'public', 'images', path.basename(s)),
  ];
  return candidates.find((c) => fs.existsSync(c)) || null;
}

function qualityNeedsUpscale(q?: string): '2k' | '4k' | null {
  const s = (q || '1k').toLowerCase();
  if (s.includes('4k') || s === 'ultra') return '4k';
  if (s.includes('2k') || s === 'fhd' || s === '1080') return '2k';
  return null;
}

export class FlowQueueEngine {
  private tasks: FlowTask[] = [];
  private mode: FlowExecutionMode = 'sequential';
  private running = false;
  private stopFlag = false;
  private delayMin: number = FLOW_DEFAULTS.delayMsMin;
  private delayMax: number = FLOW_DEFAULTS.delayMsMax;
  private activeWorkers = 0;
  private triedAccounts = new Map<string, Set<string>>();

  setMode(mode: FlowExecutionMode) {
    this.mode = mode;
  }

  setDelay(min: number, max: number) {
    this.delayMin = Math.max(0, min);
    this.delayMax = Math.max(this.delayMin, max);
  }

  snapshot() {
    return {
      mode: this.mode,
      running: this.running,
      pending: this.tasks.filter(
        (t) => t.status === 'pending' || t.status === 'running',
      ).length,
      activeWorkers: this.activeWorkers,
      tasks: [...this.tasks].slice(-200),
    };
  }

  clearPending() {
    this.tasks = this.tasks.filter(
      (t) => t.status !== 'pending' && t.status !== 'running',
    );
    this.triedAccounts.clear();
  }

  stop() {
    this.stopFlag = true;
    this.running = false;
  }

  enqueueMany(body: Record<string, unknown>): FlowTask[] {
    const kind = (body.kind === 'video' ? 'video' : 'image') as FlowTaskKind;
    const prompts: string[] = Array.isArray(body.prompts)
      ? (body.prompts as string[]).map(String)
      : body.prompt
        ? [String(body.prompt)]
        : [];
    const created: FlowTask[] = [];
    for (let i = 0; i < prompts.length; i++) {
      const t: FlowTask = {
        id: taskId(),
        kind,
        status: 'pending',
        prompt: prompts[i],
        progress: 0,
        chapterNum:
          body.chapterNum != null ? Number(body.chapterNum) : undefined,
        sceneIndex:
          body.sceneIndex != null ? Number(body.sceneIndex) : undefined,
        promptIndex:
          body.promptIndex != null ? Number(body.promptIndex) + i : i,
        aspectRatio: body.aspectRatio ? String(body.aspectRatio) : '16:9',
        imageCount: body.imageCount != null ? Number(body.imageCount) : 1,
        imageModel: body.imageModel ? String(body.imageModel) : undefined,
        videoModel: body.videoModel ? String(body.videoModel) : undefined,
        durationSec: body.durationSec != null ? Number(body.durationSec) : 6,
        quality: body.quality ? String(body.quality) : '1k',
        referenceImagePath: body.referenceImagePath
          ? String(body.referenceImagePath)
          : undefined,
        startImagePath: body.startImagePath
          ? String(body.startImagePath)
          : undefined,
        endImagePath: body.endImagePath
          ? String(body.endImagePath)
          : undefined,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        attempts: 0,
      };
      this.tasks.push(t);
      created.push(t);
    }
    return created;
  }

  start() {
    if (this.running) return;
    this.stopFlag = false;
    this.running = true;
    void this.orchestrate();
  }

  /** FlowAgent multi-worker: spawn up to N workers from ready accounts. */
  private async orchestrate() {
    const accounts = loadAccounts();
    const workerCount =
      this.mode === 'parallel'
        ? Math.max(
            1,
            Math.min(
              FLOW_DEFAULTS.maxAccountsParallel,
              accounts.filter(
                (a) => a.status === 'active' || a.flowKeyPresent,
              ).length || 1,
            ),
          )
        : 1;

    console.log(
      `[FlowQueue] orchestrate mode=${this.mode} workers=${workerCount}`,
    );

    const workers = Array.from({ length: workerCount }, (_, i) =>
      this.workerLoop(i),
    );
    await Promise.all(workers);
    this.running = false;
  }

  private async workerLoop(workerId: number) {
    while (!this.stopFlag) {
      const next = this.tasks.find((t) => t.status === 'pending');
      if (!next) {
        if (this.activeWorkers === 0) break;
        await sleep(400);
        // exit if no more pending/running
        const busy = this.tasks.some(
          (t) => t.status === 'pending' || t.status === 'running',
        );
        if (!busy) break;
        continue;
      }
      this.activeWorkers++;
      try {
        await this.executeTaskWithRetry(next, workerId);
      } finally {
        this.activeWorkers--;
      }
      if (this.stopFlag) break;
      const delay =
        this.delayMin +
        Math.floor(Math.random() * (this.delayMax - this.delayMin + 1));
      await sleep(delay);
    }
  }

  async runOne(body: Record<string, unknown>): Promise<{
    ok: boolean;
    error?: string;
    task?: FlowTask;
    resultPaths?: string[];
    mediaIds?: string[];
  }> {
    const created = this.enqueueMany(body);
    const task = created[0];
    if (!task) return { ok: false, error: 'Thiếu prompt' };
    await this.executeTaskWithRetry(task, 0);
    if (task.status === 'done') {
      return {
        ok: true,
        task,
        resultPaths: task.resultPaths,
        mediaIds: task.mediaIds,
      };
    }
    return { ok: false, error: task.error || 'Generate failed', task };
  }

  /**
   * Retry 5× + 30s on 403/network; slide account after exhausting tries on one.
   */
  private async executeTaskWithRetry(
    task: FlowTask,
    workerId: number,
  ): Promise<void> {
    const max = FLOW_DEFAULTS.maxRetries;
    let lastErr = '';

    for (let attempt = 1; attempt <= max; attempt++) {
      if (this.stopFlag) {
        task.status = 'cancelled';
        return;
      }
      task.attempts = attempt;
      task.status = 'running';
      task.progress = 5;
      task.updatedAt = Date.now();
      task.error = undefined;

      const acc = this.pickAccountForTask(task);
      if (acc) {
        task.accountId = acc.id;
        const tried =
          this.triedAccounts.get(task.id) || new Set<string>();
        tried.add(acc.id);
        this.triedAccounts.set(task.id, tried);
      }

      try {
        await this.executeTaskOnce(task);
        task.status = 'done';
        task.progress = 100;
        task.updatedAt = Date.now();
        return;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        const cat = classifyError(undefined, lastErr);
        task.retryCategory = cat;
        task.error = lastErr;
        console.warn(
          `[FlowQueue] w${workerId} attempt ${attempt}/${max} fail:`,
          lastErr.slice(0, 200),
        );

        // Token age — ask refresh
        if (cat === 'token_401') {
          try {
            const bridge = await import('./bridgeServer');
            await bridge.commandExtension('refresh_flow_tab', {});
            await sleep(3000);
          } catch {
            /* ignore */
          }
        }

        // Mark account cooldown + slide
        if (task.accountId && (cat === 'quota' || cat === 'forbidden_403')) {
          updateAccount(task.accountId, {
            status: 'cooldown',
            cooldownUntil: Date.now() + FLOW_DEFAULTS.accountCooldownMs,
            lastError: lastErr.slice(0, 200),
          });
          task.accountId = undefined; // force slide next pick
        }

        if (attempt < max) {
          task.status = 'pending';
          task.progress = 0;
          await sleep(FLOW_DEFAULTS.retryDelayMs);
        }
      }
    }

    task.status = 'failed';
    task.error = lastErr || 'Max retries exceeded';
    task.progress = 0;
    task.updatedAt = Date.now();
  }

  private pickAccountForTask(task: FlowTask) {
    const accounts = loadAccounts().map((a) => {
      // clear expired cooldown
      if (
        a.status === 'cooldown' &&
        a.cooldownUntil &&
        a.cooldownUntil <= Date.now()
      ) {
        return updateAccount(a.id, {
          status: 'active',
          cooldownUntil: null,
        })!;
      }
      return a;
    });
    const tried = this.triedAccounts.get(task.id) || new Set();
    // Prefer not-yet-tried active accounts (slide)
    const fresh = accounts.filter(
      (a) =>
        !tried.has(a.id) &&
        (a.status === 'active' || a.flowKeyPresent) &&
        !(a.cooldownUntil && a.cooldownUntil > Date.now()),
    );
    if (fresh.length) {
      fresh.sort((a, b) => a.updatedAt - b.updatedAt);
      return fresh[0];
    }
    return pickReadyAccount(accounts);
  }

  private async executeTaskOnce(task: FlowTask): Promise<void> {
    const bridge = await import('./bridgeServer');
    await bridge.ensureBridgeStarted();

    // Proactive token refresh if aged
    const snap = bridge.getBridgeSnapshot();
    if (
      snap.tokenAgeMs != null &&
      snap.tokenAgeMs > FLOW_DEFAULTS.tokenRefreshMs
    ) {
      console.log('[FlowQueue] Token age > 45m — refresh_flow_tab');
      try {
        await bridge.commandExtension('refresh_flow_tab', {});
        await sleep(2500);
      } catch {
        /* continue */
      }
    }

    const projectId = bridge.getProjectId() || 'default';
    if (task.kind === 'image') {
      await this.runImage(task, projectId, bridge);
    } else {
      await this.runVideo(task, projectId, bridge);
    }
  }

  private async runImage(
    task: FlowTask,
    projectId: string,
    bridge: typeof import('./bridgeServer'),
  ) {
    let imageMediaIds: string[] | undefined;
    const refPath = resolveLocalImage(task.referenceImagePath);
    if (refPath) {
      task.progress = 15;
      const { base64, mimeType } = fileToBase64(refPath);
      const upload = buildUploadImageBody({
        projectId,
        mimeType,
        rawImageBytes: base64,
      });
      const upRes = await bridge.requestViaExtension({
        url: upload.url,
        method: 'POST',
        headers: buildBrowserHeaders(),
        body: upload.body,
      });
      if (upRes.error || (upRes.status && upRes.status >= 400)) {
        throw new Error(
          upRes.error || `Upload ref failed HTTP ${upRes.status}`,
        );
      }
      const data = upRes.data as {
        mediaId?: { mediaId?: string } | string;
      };
      const mid =
        typeof data?.mediaId === 'string'
          ? data.mediaId
          : data?.mediaId?.mediaId;
      if (mid) imageMediaIds = [mid];
    }

    // Face-lock inject inside buildImageGenerateBody (FlowAgent stage 3)
    task.progress = 35;
    const gen = buildImageGenerateBody({
      projectId,
      prompt: task.prompt,
      aspectRatio: task.aspectRatio,
      imageCount: task.imageCount,
      imageModel: task.imageModel,
      imageMediaIds,
      faceLock: Boolean(imageMediaIds?.length || refPath),
    });

    const res = await bridge.requestViaExtension({
      url: gen.url,
      method: 'POST',
      headers: buildBrowserHeaders(),
      body: gen.body,
      captchaAction: gen.captchaAction,
      timeoutMs: 180_000,
    });

    if (res.error || (res.status && res.status >= 400)) {
      throw new Error(
        res.error ||
          `Image gen HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}`,
      );
    }

    task.progress = 70;
    let extracted = extractImageResults(res.data);

    // Stage 6: upscale 2K/4K if configured
    const up = qualityNeedsUpscale(task.quality);
    if (up && extracted.mediaIds[0]) {
      task.progress = 80;
      try {
        const upBody = buildUpsampleImageBody({
          projectId,
          mediaId: extracted.mediaIds[0],
          resolution: up,
        });
        const upRes = await bridge.requestViaExtension({
          url: upBody.url,
          method: 'POST',
          headers: buildBrowserHeaders(),
          body: upBody.body,
          captchaAction: upBody.captchaAction,
          timeoutMs: 180_000,
        });
        if (upRes.data && !upRes.error) {
          const more = extractImageResults(upRes.data);
          if (more.urls.length || more.base64List.length || more.mediaIds.length) {
            extracted = {
              mediaIds: more.mediaIds.length
                ? more.mediaIds
                : extracted.mediaIds,
              urls: more.urls.length ? more.urls : extracted.urls,
              base64List: more.base64List.length
                ? more.base64List
                : extracted.base64List,
            };
          }
        }
      } catch (e) {
        console.warn('[FlowQueue] upsample image skipped', e);
      }
    }

    const chapter = task.chapterNum ?? 0;
    const scene = task.sceneIndex ?? 0;
    const pidx = task.promptIndex ?? 0;
    const outDir = path.join(process.cwd(), 'public', 'images');
    fs.mkdirSync(outDir, { recursive: true });
    // Also mirror FlowAgent image_output folder
    const legacyDir = path.join(process.cwd(), 'image_output');
    fs.mkdirSync(legacyDir, { recursive: true });
    const paths: string[] = [];

    if (extracted.base64List.length) {
      extracted.base64List.forEach((b64, i) => {
        const name = `c${chapter}_s${scene}_p${pidx}${i ? `_${i}` : ''}.png`;
        const dest = path.join(outDir, name);
        fs.writeFileSync(dest, Buffer.from(b64, 'base64'));
        try {
          fs.copyFileSync(dest, path.join(legacyDir, name));
        } catch {
          /* ignore */
        }
        paths.push(dest);
      });
    } else if (extracted.urls.length) {
      for (let i = 0; i < extracted.urls.length; i++) {
        const name = `c${chapter}_s${scene}_p${pidx}${i ? `_${i}` : ''}.png`;
        const dest = path.join(outDir, name);
        await downloadToFile(extracted.urls[i], dest);
        try {
          fs.copyFileSync(dest, path.join(legacyDir, name));
        } catch {
          /* ignore */
        }
        paths.push(dest);
      }
    }

    if (!paths.length) {
      throw new Error(
        `Image response empty media. raw=${JSON.stringify(res.data).slice(0, 400)}`,
      );
    }

    task.resultPaths = paths;
    task.mediaIds = extracted.mediaIds;
  }

  private async runVideo(
    task: FlowTask,
    projectId: string,
    bridge: typeof import('./bridgeServer'),
  ) {
    let startMediaId: string | undefined;
    let endMediaId: string | undefined;

    const startPath = resolveLocalImage(
      task.startImagePath || task.referenceImagePath,
    );
    if (startPath) {
      task.progress = 10;
      const { base64, mimeType } = fileToBase64(startPath);
      const upload = buildUploadImageBody({
        projectId,
        mimeType,
        rawImageBytes: base64,
      });
      const upRes = await bridge.requestViaExtension({
        url: upload.url,
        method: 'POST',
        headers: buildBrowserHeaders(),
        body: upload.body,
      });
      const data = upRes.data as {
        mediaId?: { mediaId?: string } | string;
      };
      startMediaId =
        typeof data?.mediaId === 'string'
          ? data.mediaId
          : data?.mediaId?.mediaId;
    }

    const endPath = resolveLocalImage(task.endImagePath);
    if (endPath) {
      const { base64, mimeType } = fileToBase64(endPath);
      const upload = buildUploadImageBody({
        projectId,
        mimeType,
        rawImageBytes: base64,
      });
      const upRes = await bridge.requestViaExtension({
        url: upload.url,
        method: 'POST',
        headers: buildBrowserHeaders(),
        body: upload.body,
      });
      const data = upRes.data as {
        mediaId?: { mediaId?: string } | string;
      };
      endMediaId =
        typeof data?.mediaId === 'string'
          ? data.mediaId
          : data?.mediaId?.mediaId;
    }

    // FlowAgent practical path: T2V without start frame is flaky on aisandbox.
    // Auto-gen a still (Imagen) then I2V — same as "prompt only" UX for user.
    if (!startMediaId) {
      task.progress = 15;
      console.log('[FlowQueue] Video: no start frame → auto still then I2V');
      const still = buildImageGenerateBody({
        projectId,
        prompt: task.prompt,
        aspectRatio: task.aspectRatio,
        imageCount: 1,
        imageModel: FLOW_DEFAULTS.imageModel,
      });
      const stillRes = await bridge.requestViaExtension({
        url: still.url,
        method: 'POST',
        headers: buildBrowserHeaders(),
        body: still.body,
        captchaAction: still.captchaAction,
        timeoutMs: 180_000,
      });
      if (stillRes.error || (stillRes.status && stillRes.status >= 400)) {
        throw new Error(
          stillRes.error ||
            `Video auto-still failed HTTP ${stillRes.status}: ${JSON.stringify(stillRes.data).slice(0, 200)}`,
        );
      }
      const stillExtracted = extractImageResults(stillRes.data);
      startMediaId = stillExtracted.mediaIds[0];
      if (!startMediaId) {
        throw new Error(
          `Video auto-still empty mediaId. raw=${JSON.stringify(stillRes.data).slice(0, 300)}`,
        );
      }
    }

    const videoPrompt = injectFaceLockPrompt(task.prompt, {
      hasReference: true,
      mediaId: startMediaId,
    });

    task.progress = 25;

    const portrait = isPortraitRatio(task.aspectRatio);
    const modelCandidates = [
      task.videoModel && !/t2v/i.test(task.videoModel) ? task.videoModel : '',
      portrait
        ? FLOW_DEFAULTS.videoModelI2vPortrait
        : FLOW_DEFAULTS.videoModelI2vLandscape,
      portrait
        ? FLOW_DEFAULTS.videoModelI2vPortraitUltra
        : FLOW_DEFAULTS.videoModelI2vLandscapeUltra,
      'veo_3_0_i2v_s_fast',
      'veo_3_1_i2v_s_fast_fl',
    ].filter(Boolean) as string[];

    // Captcha strategies: with VIDEO captcha first, then IMAGE, then none
    const captchaStrategies: Array<string | undefined> = [
      'VIDEO_GENERATION',
      'IMAGE_GENERATION',
      undefined,
    ];

    let res: Awaited<ReturnType<typeof bridge.requestViaExtension>> | null =
      null;
    let lastVidErr = '';
    outer: for (const captchaAction of captchaStrategies) {
      for (const i2vModel of modelCandidates) {
        const gen = buildVideoI2VBody({
          projectId,
          prompt: videoPrompt,
          aspectRatio: task.aspectRatio,
          videoModel: i2vModel,
          startMediaId: startMediaId!,
          endMediaId,
        });
        console.log(
          `[FlowQueue] Video I2V model=${i2vModel} captcha=${captchaAction || 'none'}`,
        );
        try {
          res = await bridge.requestViaExtension({
            url: gen.url,
            method: 'POST',
            headers: buildBrowserHeaders(),
            body: gen.body,
            captchaAction,
            timeoutMs: 90_000,
          });
        } catch (e) {
          lastVidErr = e instanceof Error ? e.message : String(e);
          console.warn('[FlowQueue] I2V request throw', lastVidErr);
          res = null;
          continue;
        }
        if (!res.error && !(res.status && res.status >= 400)) {
          console.log('[FlowQueue] Video I2V accepted', i2vModel, captchaAction);
          break outer;
        }
        lastVidErr =
          res.error ||
          `HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 240)}`;
        console.warn('[FlowQueue] I2V failed', i2vModel, lastVidErr);
        res = null;
      }
    }

    if (!res) {
      throw new Error(`Video I2V failed: ${lastVidErr}`);
    }

    let ops = extractVideoOperations(res.data);
    task.progress = 40;

    let media = extractVideoMedia(res.data);
    let polls = 0;
    while (
      !media.done &&
      !media.urls.length &&
      polls < FLOW_DEFAULTS.videoPollMax
    ) {
      if (!ops.length) break;
      await sleep(FLOW_DEFAULTS.videoPollMs);
      polls++;
      task.progress = Math.min(85, 40 + polls);
      const check = buildCheckVideoStatusBody(ops);
      const st = await bridge.requestViaExtension({
        url: check.url,
        method: 'POST',
        headers: buildBrowserHeaders(),
        body: check.body,
        timeoutMs: 60_000,
      });
      if (st.data) {
        ops = extractVideoOperations(st.data) || ops;
        media = extractVideoMedia(st.data);
        if (media.error) throw new Error(media.error);
      }
    }

    // Upscale FHD/4K
    const q = (task.quality || '').toLowerCase();
    if (
      media.mediaIds[0] &&
      (q.includes('4k') || q.includes('fhd') || q.includes('1080'))
    ) {
      try {
        task.progress = 90;
        const up = buildUpsampleVideoBody({
          projectId,
          mediaId: media.mediaIds[0],
          aspectRatio: task.aspectRatio,
          resolution: q.includes('4k') ? '4k' : 'fhd',
        });
        const upRes = await bridge.requestViaExtension({
          url: up.url,
          method: 'POST',
          headers: buildBrowserHeaders(),
          body: up.body,
          captchaAction: up.captchaAction,
          timeoutMs: 180_000,
        });
        let upOps = extractVideoOperations(upRes.data);
        let upMedia = extractVideoMedia(upRes.data);
        let p = 0;
        while (!upMedia.urls.length && p < 45 && upOps.length) {
          await sleep(FLOW_DEFAULTS.videoPollMs);
          p++;
          const check = buildCheckVideoStatusBody(upOps);
          const st = await bridge.requestViaExtension({
            url: check.url,
            method: 'POST',
            headers: buildBrowserHeaders(),
            body: check.body,
          });
          if (st.data) {
            upOps = extractVideoOperations(st.data) || upOps;
            upMedia = extractVideoMedia(st.data);
          }
        }
        if (upMedia.urls.length) media = upMedia;
      } catch (e) {
        console.warn('[FlowQueue] video upsample skipped', e);
      }
    }

    if (!media.urls.length) {
      throw new Error(
        `Video not ready after poll. raw=${JSON.stringify(res.data).slice(0, 400)}`,
      );
    }

    const chapter = task.chapterNum ?? 0;
    const scene = task.sceneIndex ?? 0;
    const pidx = task.promptIndex ?? 0;
    const outDir = path.join(process.cwd(), 'public', 'video');
    fs.mkdirSync(outDir, { recursive: true });
    const legacyDir = path.join(process.cwd(), 'veo_output');
    fs.mkdirSync(legacyDir, { recursive: true });
    const name = `c${chapter}_s${scene}_p${pidx}.mp4`;
    const dest = path.join(outDir, name);
    await downloadToFile(media.urls[0], dest);
    try {
      fs.copyFileSync(dest, path.join(legacyDir, name));
    } catch {
      /* ignore */
    }
    task.resultPaths = [dest];
    task.mediaIds = media.mediaIds;
  }
}
