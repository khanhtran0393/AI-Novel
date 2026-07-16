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
  markAccountTaskUsed,
  accountWithinBudget,
  recordAccountTaskResult,
  computeHealthScore,
} from './accountStore';
import {
  buildBrowserHeaders,
  buildCheckVideoStatusBody,
  buildGetMediaUrl,
  buildImageGenerateBody,
  buildImageEditBody,
  buildUpsampleImageBody,
  buildUpsampleVideoBody,
  buildVideoI2VBody,
  buildVideoT2VBody,
  buildVideoIngredientsBody,
  buildVideoExtendBody,
  detectVideoModelFamily,
  extractImageResults,
  extractPendingMediaIds,
  isPortraitRatio,
  extractVideoMedia,
  extractVideoOperations,
} from './payloadBuilder';
import { fileToBase64, injectFaceLockPrompt } from './promptInjector';
import { applyCameraToPrompt, type CameraShot } from './cameraPrompt';
import { applyAgentInstructions, loadFlowOps } from './opsStore';
import { estimateTaskCredits } from './modelCatalog';
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
  const raw = message || '';
  const m = raw.toLowerCase();
  // Parse "HTTP 400: ..." when status not passed separately
  const httpMatch = raw.match(/\bHTTP\s*(\d{3})\b/i) || raw.match(/\bstatus[=:\s]+(\d{3})\b/i);
  const code = status || (httpMatch ? Number(httpMatch[1]) : undefined);

  if (code === 401 || m.includes('unauthent') || m.includes('token')) {
    return 'token_401';
  }
  if (code === 429 || m.includes('rate')) return 'rate_429';
  if (code === 403 || m.includes('forbidden') || m.includes('captcha')) {
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
  // Hard client errors (wrong model key for endpoint, bad payload) — do NOT retry 30s×5
  if (
    code === 400 ||
    code === 404 ||
    code === 422 ||
    m.includes('bad request') ||
    m.includes('invalid argument') ||
    m.includes('invalid model') ||
    m.includes('videomodelkey') ||
    m.includes('model key') ||
    m.includes('mismatched')
  ) {
    return 'content';
  }
  return 'other';
}

/** Categories that should fail the task immediately (no 30s retry loop). */
function isPermanentFailure(cat: RetryCategory, message?: string): boolean {
  if (cat === 'content' || cat === 'quota') return true;
  const m = (message || '').toLowerCase();
  if (/\bHTTP\s*400\b/i.test(message || '') || m.includes('bad request')) return true;
  return false;
}

/** Read videoModelKey actually placed in Flow request body (after auto-swap). */
function extractVideoModelKeyFromBody(body: Record<string, unknown>): string {
  try {
    const reqs = body.requests as Array<Record<string, unknown>> | undefined;
    const key = reqs?.[0]?.videoModelKey;
    return key ? String(key) : '—';
  } catch {
    return '—';
  }
}

/** Download media as the assigned account (Bearer + browser cookies if needed). */
async function downloadToFile(
  url: string,
  dest: string,
  accountId?: string,
): Promise<void> {
  if (accountId) {
    const { downloadAsAccount } = await import('./accountProxy');
    const r = await downloadAsAccount(accountId, url, dest);
    if (r.ok) {
      console.log(
        `[FlowQueue] download ${r.via} ${r.bytes}B → ${path.basename(dest)}`,
      );
      return;
    }
    console.warn('[FlowQueue] downloadAsAccount failed, node fallback', r.error);
  }
  const headers: Record<string, string> = {};
  try {
    if (accountId) {
      const { getAccountFlowKey } = await import('./bridgeServer');
      const key = getAccountFlowKey(accountId);
      if (key) headers.Authorization = `Bearer ${key}`;
    }
  } catch {
    /* ignore */
  }
  const res = await fetch(url, { headers });
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
  /**
   * Serialize runOne() — FlowAgent queue is sequential per worker.
   * Parallel /api/generate-image (gen shot 2,3…) used to stampede the extension WS
   * → "Extension API timeout" on every gen after the first.
   */
  private runOneTail: Promise<unknown> = Promise.resolve();

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
    const kindRaw = String(body.kind || 'image');
    const kind = (
      kindRaw === 'video' || kindRaw === 'extend' || kindRaw === 'edit'
        ? kindRaw
        : 'image'
    ) as FlowTaskKind;
    const ops = loadFlowOps();
    const prompts: string[] = Array.isArray(body.prompts)
      ? (body.prompts as string[]).map(String)
      : body.prompt
        ? [String(body.prompt)]
        : [];
    const ingredientPaths = Array.isArray(body.ingredientPaths)
      ? (body.ingredientPaths as unknown[]).map(String).filter(Boolean).slice(0, 3)
      : body.ingredientImagePath
        ? [String(body.ingredientImagePath)]
        : [];
    const camera =
      body.camera && typeof body.camera === 'object'
        ? (body.camera as FlowTask['camera'])
        : undefined;
    const created: FlowTask[] = [];
    for (let i = 0; i < prompts.length; i++) {
      const rawPrompt = prompts[i];
      const withCam = applyCameraToPrompt(
        rawPrompt,
        camera as CameraShot | undefined,
      );
      const prompt = applyAgentInstructions(withCam);
      const quality =
        (body.quality ? String(body.quality) : '') ||
        ops.defaultQuality ||
        'hd';
      const videoMode = body.videoMode
        ? (String(body.videoMode) as FlowTask['videoMode'])
        : kind === 'extend'
          ? 'extend'
          : ingredientPaths.length >= 1
            ? 'ingredients'
            : 'auto';
      const durationSecRaw =
        body.durationSec != null ? Number(body.durationSec) : 8;
      const estimatedCredits = estimateTaskCredits({
        kind: kind === 'edit' ? 'image' : kind === 'extend' ? 'video' : kind,
        modelId:
          kind === 'image' || kind === 'edit'
            ? body.imageModel
              ? String(body.imageModel)
              : undefined
            : body.videoModel
              ? String(body.videoModel)
              : undefined,
        imageCount: body.imageCount != null ? Number(body.imageCount) : 1,
        quality,
        durationSec: durationSecRaw,
      });
      const t: FlowTask = {
        id: taskId(),
        kind,
        status: 'pending',
        prompt,
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
        /** Flow Veo: 4|6|8 — default 8s (labs.google) */
        durationSec: durationSecRaw,
        quality,
        referenceImagePath: body.referenceImagePath
          ? String(body.referenceImagePath)
          : undefined,
        startImagePath: body.startImagePath
          ? String(body.startImagePath)
          : undefined,
        endImagePath: body.endImagePath
          ? String(body.endImagePath)
          : undefined,
        ingredientPaths: ingredientPaths.length ? ingredientPaths : undefined,
        extendMediaId: body.extendMediaId
          ? String(body.extendMediaId)
          : undefined,
        extendVideoPath: body.extendVideoPath
          ? String(body.extendVideoPath)
          : undefined,
        videoMode,
        camera,
        estimatedCredits,
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
              accounts.filter((a) => a.sessionVerified && a.email).length ||
                1,
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
    // Chain: wait for previous runOne to finish (even if it failed)
    const prev = this.runOneTail;
    let release!: () => void;
    this.runOneTail = new Promise<void>((r) => {
      release = r;
    });
    try {
      await prev.catch(() => undefined);
      const created = this.enqueueMany(body);
      const task = created[0];
      if (!task) return { ok: false, error: 'Thiếu prompt' };
      await this.executeTaskWithRetry(task, 0);
      // Anti-spam: human gap after each shot (FlowAgent delay_min/max)
      const gap =
        FLOW_DEFAULTS.runOneGapMsMin +
        Math.floor(
          Math.random() *
            (FLOW_DEFAULTS.runOneGapMsMax - FLOW_DEFAULTS.runOneGapMsMin + 1),
        );
      await sleep(gap);
      if (task.status === 'done') {
        return {
          ok: true,
          task,
          resultPaths: task.resultPaths,
          mediaIds: task.mediaIds,
        };
      }
      return { ok: false, error: task.error || 'Generate failed', task };
    } finally {
      release();
    }
  }

  /**
   * Retry (capped) + backoff — network/timeout fails fast (anti 17min spam).
   */
  private async executeTaskWithRetry(
    task: FlowTask,
    workerId: number,
  ): Promise<void> {
    let max: number = FLOW_DEFAULTS.maxRetries;
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
        markAccountTaskUsed(acc.id); // round-robin cursor
        const tried =
          this.triedAccounts.get(task.id) || new Set<string>();
        tried.add(acc.id);
        this.triedAccounts.set(task.id, tried);
        console.log(
          `[FlowQueue] w${workerId} task→profile ${acc.name || acc.id} project=${acc.projectId || '—'}`,
        );
      }

      try {
        await this.executeTaskOnce(task);
        task.status = 'done';
        task.progress = 100;
        task.updatedAt = Date.now();
        try {
          const { setFlowMediaIdsFromTask } = await import('./mediaIdIndex');
          setFlowMediaIdsFromTask({
            chapterNum: task.chapterNum,
            sceneIndex: task.sceneIndex,
            promptIndex: task.promptIndex,
            kind: task.kind,
            mediaIds: task.mediaIds,
          });
        } catch {
          /* ignore */
        }
        if (task.accountId) {
          recordAccountTaskResult(
            task.accountId,
            true,
            task.estimatedCredits || 0,
          );
        }
        return;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        const cat = classifyError(undefined, lastErr);
        task.retryCategory = cat;
        task.error = lastErr;
        // Network/timeout: shrink remaining budget so we never spam 5×30s
        if (cat === 'network' || cat === 'rate_429') {
          max = Math.min(max, FLOW_DEFAULTS.maxRetriesNetwork);
        }
        console.warn(
          `[FlowQueue] w${workerId} attempt ${attempt}/${max} fail [${cat}]:`,
          lastErr.slice(0, 200),
        );

        // Permanent 400 / model mismatch — fail fast (was stuck "Đang gửi..." 30s×5)
        if (isPermanentFailure(cat, lastErr)) {
          console.error(
            `[FlowQueue] permanent failure — stop retry:`,
            lastErr.slice(0, 240),
          );
          task.status = 'failed';
          task.progress = 0;
          task.updatedAt = Date.now();
          if (task.accountId) {
            recordAccountTaskResult(task.accountId, false, 0);
          }
          return;
        }

        // Token age / 401 — refresh tab; optional auto-relogin (P3)
        if (cat === 'token_401') {
          try {
            const bridge = await import('./bridgeServer');
            await bridge.commandExtension('refresh_flow_tab', {}, 60000, task.accountId);
            await sleep(3000);
            const ops = loadFlowOps();
            const acc = task.accountId
              ? loadAccounts().find((a) => a.id === task.accountId)
              : null;
            if (
              ops.autoRelogin &&
              acc?.autoRelogin !== false &&
              attempt >= 2
            ) {
              console.log(
                '[FlowQueue] P3 auto-relogin bootstrap for',
                task.accountId,
              );
              const { bootstrapFlow } = await import('./bootstrap');
              await bootstrapFlow({
                forceChrome: true,
                engine: 'auto',
                waitExtensionMs: 25000,
                waitLoginMs: 15000,
                accountId: task.accountId,
              });
            }
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
          recordAccountTaskResult(task.accountId, false, 0);
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
    if (task.accountId) {
      recordAccountTaskResult(task.accountId, false, 0);
    }
    task.progress = 0;
    task.updatedAt = Date.now();
  }

  private pickAccountForTask(task: FlowTask) {
    const ops = loadFlowOps();
    const need = task.estimatedCredits || 1;
    // Prefer profile that owns the live Bearer (prevents NO_FLOW_KEY on wrong socket)
    let preferredLiveId: string | null = null;
    try {
      // Avoid hard import cycle: read snapshot from global bridge state if present
      const g = globalThis as unknown as {
        __ainovelFlowBridge?: {
          flowKey?: string | null;
          flowKeyAccountId?: string | null;
          activeAccountId?: string | null;
        };
      };
      const st = g.__ainovelFlowBridge;
      if (st?.flowKey && String(st.flowKey).length >= 20) {
        preferredLiveId = st.flowKeyAccountId || st.activeAccountId || null;
        if (preferredLiveId) preferredLiveId = String(preferredLiveId);
      }
    } catch {
      /* ignore */
    }
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
          healthScore: computeHealthScore({ ...a, status: 'active', cooldownUntil: null }),
        })!;
      }
      const hs = computeHealthScore(a);
      if (hs !== a.healthScore) {
        return updateAccount(a.id, { healthScore: hs }) || a;
      }
      return a;
    });
    const tried = this.triedAccounts.get(task.id) || new Set();
    // Prefer not-yet-tried ready accounts — health + budget + lastTaskAt
    const fresh = accounts.filter(
      (a) =>
        !tried.has(a.id) &&
        a.sessionVerified &&
        a.email &&
        !(a.cooldownUntil && a.cooldownUntil > Date.now()) &&
        !(a.status === 'cooldown' && a.cooldownUntil && a.cooldownUntil > Date.now()) &&
        (a.healthScore == null || a.healthScore >= ops.minHealthScore) &&
        accountWithinBudget(a, need),
    );
    if (fresh.length) {
      if (preferredLiveId) {
        const live = fresh.find((a) => a.id === preferredLiveId);
        if (live) return live;
      }
      fresh.sort(
        (a, b) =>
          (b.healthScore || 0) - (a.healthScore || 0) ||
          (a.lastTaskAt || 0) - (b.lastTaskAt || 0) ||
          a.updatedAt - b.updatedAt,
      );
      return fresh[0];
    }
    // Fallback: ignore health floor but still respect budget when possible
    const budgeted = accounts.filter(
      (a) =>
        !tried.has(a.id) &&
        a.sessionVerified &&
        a.email &&
        accountWithinBudget(a, need),
    );
    if (budgeted.length) {
      budgeted.sort((a, b) => (a.lastTaskAt || 0) - (b.lastTaskAt || 0));
      return budgeted[0];
    }
    return pickReadyAccount(accounts);
  }

  private async executeTaskOnce(task: FlowTask): Promise<void> {
    const bridge = await import('./bridgeServer');
    await bridge.ensureBridgeStarted();

    // Proactive token refresh if aged
    const snap = bridge.getBridgeSnapshot();
    // Ensure extension SW actually holds Bearer (bridge status can be stale-green)
    try {
      const st = await bridge.commandExtension(
        'get_status',
        {},
        8000,
        task.accountId,
      );
      const extHasKey = Boolean(
        (st.result as { flowKeyPresent?: boolean } | undefined)?.flowKeyPresent,
      );
      if (!extHasKey && snap.flowKeyPresent) {
        console.log(
          '[FlowQueue] Extension missing flowKey while bridge has token — inject + harvest',
        );
        // inject_flow_key is handled if SW already has the new code; also harvest
        try {
          await bridge.commandExtension(
            'inject_flow_key',
            {},
            5000,
            task.accountId,
          );
        } catch {
          /* older SW may not know method */
        }
        try {
          await bridge.commandExtension(
            'force_token_harvest',
            {},
            45000,
            task.accountId,
          );
          await sleep(1500);
        } catch {
          /* continue — requestViaExtension still passes flowKey param */
        }
      }
    } catch {
      /* ignore status probe */
    }
    if (
      snap.tokenAgeMs != null &&
      snap.tokenAgeMs > FLOW_DEFAULTS.tokenRefreshMs
    ) {
      console.log('[FlowQueue] Token age > 45m — refresh_flow_tab');
      try {
        await bridge.commandExtension('refresh_flow_tab', {}, 60000, task.accountId);
        await sleep(2500);
      } catch {
        /* continue */
      }
    }

    // Project belonging to the assigned profile ONLY (B10: no cross-account steal)
    const { isPlausibleProjectId } = await import('./projectStore');
    const accRow = loadAccounts().find((a) => a.id === task.accountId);
    let projectId =
      bridge.getProjectId(task.accountId) || accRow?.projectId || '';
    if (!isPlausibleProjectId(projectId)) {
      const fromList = (accRow?.projects || []).find((p) =>
        isPlausibleProjectId(p.id),
      );
      projectId = fromList?.id || '';
    }
    // FlowAgent always has a real project after login — auto-create if missing/fake
    if (!isPlausibleProjectId(projectId)) {
      console.warn(
        `[FlowQueue] no real project on ${accRow?.name || task.accountId} — createFlowProject…`,
      );
      const created = await bridge.createFlowProject(
        `AI Novel ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
        task.accountId,
      );
      if (created.ok && created.project?.id && isPlausibleProjectId(created.project.id)) {
        projectId = created.project.id;
        if (task.accountId) {
          updateAccount(task.accountId, {
            projectId,
            projects: [
              {
                id: projectId,
                title: created.project.title || projectId,
                source: 'create',
                createdAt: Date.now(),
                updatedAt: Date.now(),
              },
              ...((accRow?.projects || []).filter(
                (p) => isPlausibleProjectId(p.id) && p.id !== projectId,
              ) || []),
            ],
          });
        }
      }
    }
    if (!isPlausibleProjectId(projectId)) {
      throw new Error(
        `Profile ${accRow?.name || task.accountId || '?'} chưa gắn Google Flow Project thật (id giả/smoke đã bị chặn). Media Config → card profile → Project → Sync / + Tạo, hoặc đăng nhập lại Flow để extension capture projectId.`,
      );
    }
    if (task.kind === 'image' || task.kind === 'edit') {
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
    // Optional face/cast ref — FlowAgent: upload then IMAGE_INPUT. If upload times out
    // (common on gen #2+ when auto-ref from shot #1), fall back to text-only + faceLock
    // prompt so shot 2/3 still generate instead of 17min retry death.
    if (refPath) {
      task.progress = 15;
      try {
        const mid = await this.uploadLocalImage(
          refPath,
          projectId,
          bridge,
          task.accountId,
        );
        if (mid) imageMediaIds = [mid];
      } catch (upErr) {
        const msg = upErr instanceof Error ? upErr.message : String(upErr);
        if (task.kind === 'edit') {
          // Edit without base media is meaningless — hard fail
          throw upErr;
        }
        console.warn(
          `[FlowQueue] face-ref upload failed — text-only fallback: ${msg.slice(0, 220)}`,
        );
        imageMediaIds = undefined;
      }
    }

    // Face-lock inject inside buildImageGenerateBody (FlowAgent stage 3)
    // edit kind: base ref + edit prompt (P1 object/light edit via re-gen)
    task.progress = 35;
    const gen =
      task.kind === 'edit' && imageMediaIds?.[0]
        ? buildImageEditBody({
            projectId,
            prompt: task.prompt,
            aspectRatio: task.aspectRatio,
            imageModel: task.imageModel,
            baseMediaId: imageMediaIds[0],
          })
        : buildImageGenerateBody({
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
      accountId: task.accountId,
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
          accountId: task.accountId,
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
        await downloadToFile(extracted.urls[i], dest, task.accountId);
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
    // App nhận cùng state account (credits) sau gen
    void import('./accountProxy').then((m) =>
      m.refreshAccountAfterTask(task.accountId),
    );
  }

  private async uploadLocalImage(
    absPath: string,
    projectId: string,
    bridge: typeof import('./bridgeServer'),
    accountId?: string,
  ): Promise<string | undefined> {
    const { base64, mimeType, byteLength } = fileToBase64(absPath);
    // Large base64 over WS often times out — warn; still try (PNG from Imagen ~1MB).
    if (byteLength > 2_500_000) {
      console.warn(
        `[FlowQueue] Large upload ${byteLength} bytes — may timeout on WS`,
      );
    }
    const {
      buildUploadImageCandidates,
      extractUploadMediaId,
    } = await import('./payloadBuilder');
    const fileName = path.basename(absPath) || 'upload.png';
    const allCandidates = buildUploadImageCandidates({
      projectId,
      mimeType,
      rawImageBytes: base64,
      fileName,
    });
    for (const c of allCandidates) {
      if (c.body && 'imageInput' in c.body) {
        delete c.body.imageInput;
      }
    }
    // Anti-spam: only primary FlowAgent shapes (not 4× long timeouts)
    const candidates = allCandidates.slice(
      0,
      Math.max(1, FLOW_DEFAULTS.maxUploadShapes),
    );
    const timeoutMs = Math.min(90_000, 45_000 + Math.floor(byteLength / 80));
    const errors: string[] = [];

    for (const upload of candidates) {
      try {
        console.log(
          `[FlowQueue] Upload try ${upload.label} keys=${Object.keys(upload.body).join(',')}`,
        );
        const upRes = await bridge.requestViaExtension({
          url: upload.url,
          method: 'POST',
          headers: buildBrowserHeaders(),
          body: upload.body,
          timeoutMs,
          accountId,
        });
        if (upRes.error || (upRes.status && upRes.status >= 400)) {
          const snippet = JSON.stringify(upRes.data ?? upRes.error).slice(
            0,
            220,
          );
          errors.push(`${upload.label}: HTTP ${upRes.status} ${snippet}`);
          continue;
        }
        // Live response: { media: { name: "<uuid>" } }
        const mid = extractUploadMediaId(upRes.data);
        if (mid) {
          console.log(
            `[FlowQueue] Upload OK shape=${upload.label} mediaId=${mid.slice(0, 24)}…`,
          );
          return mid;
        }
        errors.push(
          `${upload.label}: 200 but no mediaId in ${JSON.stringify(upRes.data).slice(0, 160)}`,
        );
      } catch (e) {
        const em = e instanceof Error ? e.message : String(e);
        errors.push(`${upload.label}: ${em}`);
        // First timeout → stop shapes (more shapes = more spam, same failure)
        if (/timeout/i.test(em)) {
          console.warn(
            '[FlowQueue] Upload timeout — skip remaining shapes (anti-spam)',
          );
          break;
        }
      }
    }

    throw new Error(
      `Upload failed (tried ${candidates.length}/${allCandidates.length} shapes). ` +
        `First: ${errors.slice(0, 2).join(' | ')}`,
    );
  }

  private async runVideo(
    task: FlowTask,
    projectId: string,
    bridge: typeof import('./bridgeServer'),
  ) {
    let startMediaId: string | undefined;
    let endMediaId: string | undefined;
    let resEarly: Awaited<ReturnType<typeof bridge.requestViaExtension>> | null =
      null;
    let lastVidErrEarly = '';
    const vMode =
      task.videoMode || (task.kind === 'extend' ? 'extend' : 'auto');

    // P0 Extend
    if ((vMode === 'extend' || task.kind === 'extend') && task.extendMediaId) {
      task.progress = 20;
      try {
        // Only pass UI model when it is already extend family; else family default
        const extendModel =
          detectVideoModelFamily(task.videoModel) === 'extend'
            ? task.videoModel
            : undefined;
        const genEx = buildVideoExtendBody({
          projectId,
          prompt: task.prompt,
          aspectRatio: task.aspectRatio,
          videoModel: extendModel,
          sourceMediaId: task.extendMediaId,
          durationSec: task.durationSec,
        });
        const resolvedEx = extractVideoModelKeyFromBody(genEx.body);
        console.log(
          `[FlowQueue] Video EXTEND model=${resolvedEx} ui=${task.videoModel || '—'} media=${task.extendMediaId.slice(0, 14)}`,
        );
        resEarly = await bridge.requestViaExtension({
          url: genEx.url,
          method: 'POST',
          headers: buildBrowserHeaders(),
          body: genEx.body,
          captchaAction: genEx.captchaAction,
          timeoutMs: 90_000,
          accountId: task.accountId,
        });
        if (resEarly.error || (resEarly.status && resEarly.status >= 400)) {
          lastVidErrEarly =
            resEarly.error ||
            `HTTP ${resEarly.status}: ${JSON.stringify(resEarly.data).slice(0, 200)}`;
          resEarly = null;
        }
      } catch (e) {
        lastVidErrEarly = e instanceof Error ? e.message : String(e);
        resEarly = null;
      }
    }

    // P0 Ingredients 1–3
    if (
      !resEarly &&
      (vMode === 'ingredients' || (task.ingredientPaths?.length || 0) > 0)
    ) {
      const paths = (task.ingredientPaths || [])
        .map((pp) => resolveLocalImage(pp))
        .filter(Boolean) as string[];
      for (const extra of [
        task.startImagePath,
        task.referenceImagePath,
        task.endImagePath,
      ]) {
        const r = resolveLocalImage(extra);
        if (r && !paths.includes(r)) paths.push(r);
      }
      const mediaIds: string[] = [];
      task.progress = 12;
      for (const pp of paths.slice(0, 3)) {
        const mid = await this.uploadLocalImage(
          pp,
          projectId,
          bridge,
          task.accountId,
        );
        if (mid) mediaIds.push(mid);
      }
      if (mediaIds.length) {
        try {
          const videoPromptIng = injectFaceLockPrompt(task.prompt, {
            hasReference: true,
            mediaId: mediaIds[0],
          });
          // Must be reference family — wrong UI model throws MODEL_MISMATCH (no swap)
          // Ingredients need R2V keys; if UI has T2V/I2V selected use r2v default (not silent provider swap)
          const ingModel =
            detectVideoModelFamily(task.videoModel) === 'reference'
              ? task.videoModel
              : undefined;
          const genIng = buildVideoIngredientsBody({
            projectId,
            prompt: videoPromptIng,
            aspectRatio: task.aspectRatio,
            videoModel: ingModel,
            referenceMediaIds: mediaIds,
            durationSec: task.durationSec,
          });
          const resolvedIng = extractVideoModelKeyFromBody(genIng.body);
          console.log(
            `[FlowQueue] Video INGREDIENTS n=${mediaIds.length} model=${resolvedIng} ui=${task.videoModel || '—'}`,
          );
          resEarly = await bridge.requestViaExtension({
            url: genIng.url,
            method: 'POST',
            headers: buildBrowserHeaders(),
            body: genIng.body,
            captchaAction: genIng.captchaAction,
            timeoutMs: 90_000,
            accountId: task.accountId,
          });
          if (resEarly.error || (resEarly.status && resEarly.status >= 400)) {
            lastVidErrEarly =
              resEarly.error ||
              `HTTP ${resEarly.status}: ${JSON.stringify(resEarly.data).slice(0, 200)}`;
            resEarly = null;
            startMediaId = mediaIds[0];
            endMediaId = mediaIds[1];
          }
        } catch (e) {
          lastVidErrEarly = e instanceof Error ? e.message : String(e);
          resEarly = null;
          startMediaId = mediaIds[0];
          endMediaId = mediaIds[1];
        }
      }
    }

    const startPath = resolveLocalImage(
      task.startImagePath || task.referenceImagePath,
    );
    if (startPath && !startMediaId && !resEarly) {
      task.progress = 10;
      startMediaId = await this.uploadLocalImage(
        startPath,
        projectId,
        bridge,
        task.accountId,
      );
      if (!startMediaId) {
        throw new Error(
          `Upload start image failed (no mediaId). path=${startPath}`,
        );
      }
    }

    const endPath = resolveLocalImage(task.endImagePath);
    if (endPath && !endMediaId && !resEarly) {
      task.progress = 18;
      endMediaId = await this.uploadLocalImage(
        endPath,
        projectId,
        bridge,
        task.accountId,
      );
    }

    /**
     * IRON B10 — no silent path switching:
     * - no start image → pure T2V only (one model, one captcha VIDEO_GENERATION)
     * - has start image → pure I2V only (one model, one captcha)
     * - NO auto-still→I2V, NO multi-model waterfall, NO captcha ladder
     */
    const wantPureT2v =
      !startMediaId &&
      !resEarly &&
      (vMode === 'auto' || vMode === 't2v' || !task.startImagePath);

    if (wantPureT2v) {
      task.progress = 12;
      const gen = buildVideoT2VBody({
        projectId,
        prompt: task.prompt,
        aspectRatio: task.aspectRatio,
        videoModel: task.videoModel,
        durationSec: task.durationSec,
      });
      const resolvedT2v = extractVideoModelKeyFromBody(gen.body);
      console.log(
        `[FlowQueue] Video pure T2V model=${resolvedT2v} ui=${task.videoModel || '—'}`,
      );
      const t2vRes = await bridge.requestViaExtension({
        url: gen.url,
        method: 'POST',
        headers: buildBrowserHeaders(),
        body: gen.body,
        captchaAction: 'VIDEO_GENERATION',
        timeoutMs: 90_000,
        accountId: task.accountId,
      });
      if (t2vRes.error || (t2vRes.status && t2vRes.status >= 400)) {
        throw new Error(
          t2vRes.error ||
            `HTTP ${t2vRes.status}: ${JSON.stringify(t2vRes.data).slice(0, 240)}. ` +
              `T2V that bai — app khong fallback auto-still/I2V. Kiem tra model T2V / captcha / token.`,
        );
      }
      resEarly = t2vRes;
      lastVidErrEarly = '';
      console.log('[FlowQueue] pure T2V accepted', resolvedT2v);
    }

    if (!startMediaId && !resEarly) {
      throw new Error(
        'Video: thieu start image va T2V khong chay. ' +
          'Gen anh truoc (I2V) hoac chon mode T2V + model T2V dung. ' +
          'App khong auto tao still de I2V (IRON B10).',
      );
    }

    const videoPrompt = injectFaceLockPrompt(task.prompt, {
      hasReference: Boolean(startMediaId),
      mediaId: startMediaId,
    });

    task.progress = resEarly ? 40 : 25;

    let res: Awaited<ReturnType<typeof bridge.requestViaExtension>> | null =
      resEarly;
    let lastVidErr = lastVidErrEarly || '';
    if (res) {
      console.log('[FlowQueue] Using EXTEND/INGREDIENTS/T2V response');
    } else if (startMediaId) {
      // Single I2V attempt — model must match family (no ultra/t2v ladder)
      const gen = buildVideoI2VBody({
        projectId,
        prompt: videoPrompt,
        aspectRatio: task.aspectRatio,
        videoModel: task.videoModel,
        startMediaId: startMediaId!,
        endMediaId,
        durationSec: task.durationSec,
      });
      const resolvedI2v = extractVideoModelKeyFromBody(gen.body);
      console.log(
        `[FlowQueue] Video I2V model=${resolvedI2v} ui=${task.videoModel || '—'} captcha=VIDEO_GENERATION`,
      );
      try {
        res = await bridge.requestViaExtension({
          url: gen.url,
          method: 'POST',
          headers: buildBrowserHeaders(),
          body: gen.body,
          captchaAction: 'VIDEO_GENERATION',
          timeoutMs: 90_000,
          accountId: task.accountId,
        });
      } catch (e) {
        lastVidErr = e instanceof Error ? e.message : String(e);
        throw new Error(
          `Video I2V request throw: ${lastVidErr}. Khong retry model khac (B10).`,
        );
      }
      if (res.error || (res.status && res.status >= 400)) {
        lastVidErr =
          res.error ||
          `HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 240)}`;
        throw new Error(
          `Video I2V failed: ${lastVidErr}. ` +
            `Neu UI dang chon model T2V ma co start image → chon model I2V (vd. veo_3_1_i2v_s_fast). Khong auto-swap (B10).`,
        );
      }
      console.log('[FlowQueue] Video I2V accepted', resolvedI2v);
    }

    if (!res) {
      throw new Error(`Video gen failed: ${lastVidErr || 'no response'}`);
    }

    let ops = extractVideoOperations(res.data);
    task.progress = 40;

    let media = extractVideoMedia(res.data);
    let pendingIds = [
      ...media.mediaIds,
      ...extractPendingMediaIds(res.data),
    ].filter(Boolean);
    pendingIds = [...new Set(pendingIds)];

    console.log(
      `[FlowQueue] Video poll start ops=${ops.length} mediaIds=${pendingIds.length}`,
      pendingIds.slice(0, 3),
    );

    const mediaReady = (m: typeof media) =>
      Boolean(m.urls.length || m.base64List?.length);

    let polls = 0;
    let lastPollRaw = '';
    while (!mediaReady(media) && polls < FLOW_DEFAULTS.videoPollMax) {
      await sleep(FLOW_DEFAULTS.videoPollMs);
      polls++;
      task.progress = Math.min(85, 40 + polls);

      // Strategy 1: batchCheck — only { operation: { name: primaryMediaId } }
      if (ops.length) {
        try {
          const check = buildCheckVideoStatusBody(ops);
          const st = await bridge.requestViaExtension({
            url: check.url,
            method: 'POST',
            headers: buildBrowserHeaders(),
            body: check.body,
            timeoutMs: 60_000,
            accountId: task.accountId,
          });
          if (st.data) {
            lastPollRaw = JSON.stringify(st.data).slice(0, 500);
            const nextOps = extractVideoOperations(st.data);
            if (nextOps.length) ops = nextOps;
            const m = extractVideoMedia(st.data);
            if (m.error && !mediaReady(m)) {
              // keep polling transient errors unless hard fail
              if (/failed|forbidden|unauth|policy|safety|not found/i.test(m.error)) {
                // "Video not found" on wrong op name — do not hard-fail; fall through to GET media
                if (!/not found/i.test(m.error)) throw new Error(m.error);
              }
            }
            if (mediaReady(m)) {
              media = m;
              break;
            }
            for (const id of m.mediaIds) {
              if (!pendingIds.includes(id)) pendingIds.push(id);
            }
          } else if (st.error) {
            lastPollRaw = st.error;
            console.warn('[FlowQueue] batchCheck err', st.error.slice(0, 160));
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/failed|forbidden|unauth|policy|safety/i.test(msg) && !/not found/i.test(msg)) {
            throw e;
          }
          console.warn('[FlowQueue] batchCheck throw', msg.slice(0, 160));
        }
      }

      // Strategy 2: GET /v1/media/{id} — often returns video.encodedVideo (base64 MP4)
      for (const mid of pendingIds.slice(0, 6)) {
        try {
          const st = await bridge.requestViaExtension({
            url: buildGetMediaUrl(mid),
            method: 'GET',
            headers: buildBrowserHeaders(),
            timeoutMs: 90_000,
            accountId: task.accountId,
          });
          if (st.data) {
            lastPollRaw = JSON.stringify(st.data).slice(0, 500);
            const m = extractVideoMedia(st.data);
            if (mediaReady(m)) {
              media = m;
              if (!media.mediaIds.length) media.mediaIds = [mid];
              break;
            }
          }
        } catch (e) {
          console.warn(
            '[FlowQueue] getMedia',
            mid.slice(0, 12),
            e instanceof Error ? e.message : e,
          );
        }
      }
      if (mediaReady(media)) break;

      if (polls % 10 === 0) {
        console.log(
          `[FlowQueue] Video still polling #${polls} ops=${ops.length} ids=${pendingIds.length}`,
        );
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
          accountId: task.accountId,
      });
        let upOps = extractVideoOperations(upRes.data);
        let upMedia = extractVideoMedia(upRes.data);
        let p = 0;
        while (
          !upMedia.urls.length &&
          !(upMedia.base64List && upMedia.base64List.length) &&
          p < 45
        ) {
          await sleep(FLOW_DEFAULTS.videoPollMs);
          p++;
          if (upOps.length) {
            const check = buildCheckVideoStatusBody(upOps);
            const st = await bridge.requestViaExtension({
              url: check.url,
              method: 'POST',
              headers: buildBrowserHeaders(),
              body: check.body,
              accountId: task.accountId,
            });
            if (st.data) {
              upOps = extractVideoOperations(st.data) || upOps;
              upMedia = extractVideoMedia(st.data);
            }
          }
          const upIds = upMedia.mediaIds.length
            ? upMedia.mediaIds
            : extractPendingMediaIds(upRes.data);
          for (const mid of upIds.slice(0, 3)) {
            const st = await bridge.requestViaExtension({
              url: buildGetMediaUrl(mid),
              method: 'GET',
              headers: buildBrowserHeaders(),
              accountId: task.accountId,
            });
            if (st.data) {
              const m = extractVideoMedia(st.data);
              if (m.urls.length || m.base64List?.length) upMedia = m;
            }
          }
          if (upMedia.urls.length || upMedia.base64List?.length) break;
        }
        if (upMedia.urls.length || upMedia.base64List?.length) media = upMedia;
      } catch (e) {
        console.warn('[FlowQueue] video upsample skipped', e);
      }
    }

    if (!media.urls.length && !(media.base64List && media.base64List.length)) {
      throw new Error(
        `Video not ready after poll (polls=${polls}, ops=${ops.length}, ids=${pendingIds.join(',')}). last=${lastPollRaw.slice(0, 280)} raw=${JSON.stringify(res.data).slice(0, 280)}`,
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
    if (media.base64List?.length) {
      // GET /v1/media returns encodedVideo base64 — write MP4 directly
      const b64 = media.base64List[0].replace(/^data:[^;]+;base64,/, '');
      fs.writeFileSync(dest, Buffer.from(b64, 'base64'));
      console.log(
        `[FlowQueue] Video wrote base64 → ${dest} (${fs.statSync(dest).size}B)`,
      );
    } else {
      await downloadToFile(media.urls[0], dest, task.accountId);
    }
    try {
      fs.copyFileSync(dest, path.join(legacyDir, name));
    } catch {
      /* ignore */
    }
    task.resultPaths = [dest];
    task.mediaIds = media.mediaIds;
    // App nhận cùng state account (credits/media) sau gen
    void import('./accountProxy').then((m) =>
      m.refreshAccountAfterTask(task.accountId),
    );
  }
}
