/**
 * FlowAgent Task Queue & Worker Threading (Node port).
 * Google Flow runtime standards:
 * - Shared pending queue + N workers (≤ accounts, max 3)
 * - Max 1 concurrent gen per Labs account (parallel = multi-account)
 * - Human delay jitter between tasks
 * - Error taxonomy + VN action messages (no auto model swap — B10)
 * - Progress steps + recycle after success (session drift / RAM)
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
  buildVideoFrontendTelemetryBody,
  buildVideoIngredientsBody,
  buildVideoExtendBody,
  detectVideoModelFamily,
  extractImageResults,
  extractPendingMediaIds,
  isPortraitRatio,
  extractVideoMedia,
  extractVideoOperations,
} from './payloadBuilder';
import { injectFaceLockPrompt } from './promptInjector';
import { applyCameraToPrompt, type CameraShot } from './cameraPrompt';
import { applyAgentInstructions, loadFlowOps } from './opsStore';
import { estimateTaskCredits, requireFlowVideoDuration } from './modelCatalog';
import {
  classifyFlowError,
  describeFlowError,
  formatFlowTaskError,
  isPermanentFlowFailure,
} from './flowRuntimeErrors';
import {
  isAccountBusy,
  listBusyAccountIds,
  markAccountBusy,
  markAccountFree,
  scheduleFlowRuntimeRecycle,
} from './flowRuntimeRecycle';
import { applyFlowTaskStep } from './flowRuntimeSteps';
import type {
  FlowExecutionMode,
  FlowTask,
  FlowTaskKind,
  RetryCategory,
} from './types';
import { resolveImageReferenceTransportPath } from '@/lib/mediaReference';

function taskId(): string {
  return `ft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function classifyError(status?: number, message?: string): RetryCategory {
  return classifyFlowError(status, message);
}

/** Categories that should fail the task immediately (no long retry loop). */
function isPermanentFailure(cat: RetryCategory, message?: string): boolean {
  return isPermanentFlowFailure(cat, message);
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

/** Ensure the canonical .png output actually contains PNG bytes. */
export async function normalizeFlowImageOutput(dest: string): Promise<void> {
  if (path.extname(dest).toLowerCase() !== '.png' || !fs.existsSync(dest)) return;
  const input = fs.readFileSync(dest);
  const isJpeg =
    input.length >= 3 &&
    input[0] === 0xff &&
    input[1] === 0xd8 &&
    input[2] === 0xff;
  if (!isJpeg) return;
  const sharp = (await import('sharp')).default;
  const png = await sharp(input).png().toBuffer();
  fs.writeFileSync(dest, png);
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
      await normalizeFlowImageOutput(dest);
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
  await normalizeFlowImageOutput(dest);
}

function resolveLocalImage(ref?: string): string | null {
  if (!ref) return null;
  const s = resolveImageReferenceTransportPath(ref);
  if (!s) return null;
  if (path.isAbsolute(s) && fs.existsSync(s)) return s;
  const candidates = [
    path.join(/* turbopackIgnore: true */ process.cwd(), s),
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
    const active = this.tasks.filter(
      (t) => t.status === 'pending' || t.status === 'running',
    );
    // Refresh queueAhead for pending tasks (position in line)
    const pendingOrdered = this.tasks.filter((t) => t.status === 'pending');
    for (let i = 0; i < pendingOrdered.length; i++) {
      pendingOrdered[i].queueAhead = i;
      if (
        pendingOrdered[i].status === 'pending' &&
        !String(pendingOrdered[i].progressMessage || '').includes('trước bạn')
      ) {
        pendingOrdered[i].progressMessage =
          i === 0
            ? 'Đầu hàng đợi Google Flow…'
            : `Hàng đợi Flow — còn ${i} job trước bạn…`;
      }
    }
    return {
      mode: this.mode,
      running: this.running,
      pending: active.length,
      activeWorkers: this.activeWorkers,
      tasks: [...this.tasks].slice(-200),
    };
  }

  getTask(id: string): FlowTask | undefined {
    return this.tasks.find((t) => t.id === id);
  }

  /** Latest matching storyboard coords (video/extend preferred by kind). */
  findTaskByCoords(opts: {
    kind?: string;
    chapterNum: number;
    sceneIndex: number;
    promptIndex?: number;
  }): FlowTask | undefined {
    const kind = opts.kind || 'video';
    const pi =
      opts.promptIndex != null && Number.isFinite(Number(opts.promptIndex))
        ? Number(opts.promptIndex)
        : undefined;
    return [...this.tasks].reverse().find((t) => {
      if (kind === 'video') {
        if (t.kind !== 'video' && t.kind !== 'extend') return false;
      } else if (t.kind !== kind) {
        return false;
      }
      if (Number(t.chapterNum) !== Number(opts.chapterNum)) return false;
      if (Number(t.sceneIndex) !== Number(opts.sceneIndex)) return false;
      if (pi != null && Number(t.promptIndex) !== pi) return false;
      return true;
    });
  }

  /**
   * Enqueue + start workers without waiting for completion (async gen path).
   * Returns the first created task id.
   */
  enqueueAndStart(body: Record<string, unknown>): {
    ok: boolean;
    error?: string;
    task?: FlowTask;
    tasks?: FlowTask[];
  } {
    this.stopFlag = false;
    const ahead = this.tasks.filter(
      (t) => t.status === 'pending' || t.status === 'running',
    ).length;
    const created = this.enqueueMany(body);
    const task = created[0];
    if (!task) return { ok: false, error: 'Thiếu prompt' };
    task.queueAhead = ahead;
    if (typeof body.appSavePath === 'string' && body.appSavePath.trim()) {
      task.appSavePath = body.appSavePath.trim();
    }
    if (typeof body.correlationId === 'string' && body.correlationId.trim()) {
      task.correlationId = body.correlationId.trim();
    }
    task.progressMessage =
      ahead > 0
        ? `Hàng đợi Flow — còn ${ahead} job trước bạn…`
        : 'Đã xếp hàng — bắt đầu khi worker rảnh…';
    this.start();
    return { ok: true, task, tasks: created };
  }

  clearPending() {
    // Free busy locks for tasks we drop (running/pending) to avoid stuck accounts
    for (const t of this.tasks) {
      if (
        (t.status === 'pending' || t.status === 'running') &&
        t.accountId
      ) {
        markAccountFree(t.accountId);
      }
    }
    this.tasks = this.tasks.filter(
      (t) => t.status !== 'pending' && t.status !== 'running',
    );
    this.triedAccounts.clear();
  }

  stop() {
    this.stopFlag = true;
    this.running = false;
    // Free every busy profile so a later runOne / start is not deadlocked
    // waiting forever on maxConcurrentTasksPerAccount.
    for (const id of listBusyAccountIds()) markAccountFree(id);
  }

  /** Allow generate-one / start after a previous queue stop. */
  resumeFromStop() {
    this.stopFlag = false;
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
      // Start+End (start+end paths distinct) stays auto/I2V first+last — not ingredients.
      const startP = body.startImagePath
        ? String(body.startImagePath)
        : body.referenceImagePath
          ? String(body.referenceImagePath)
          : '';
      const endP = body.endImagePath ? String(body.endImagePath) : '';
      const dualI2vEnqueue = Boolean(
        startP &&
          endP &&
          resolveImageReferenceTransportPath(startP) !==
            resolveImageReferenceTransportPath(endP),
      );
      const videoMode = body.videoMode
        ? (String(body.videoMode) as FlowTask['videoMode'])
        : kind === 'extend'
          ? 'extend'
          : dualI2vEnqueue
            ? 'auto'
            : ingredientPaths.length >= 1
              ? 'ingredients'
              : 'auto';
      const durationSecRaw =
        kind === 'video' || kind === 'extend'
          ? requireFlowVideoDuration(
              body.durationSec != null ? Number(body.durationSec) : undefined,
              body.videoModel ? String(body.videoModel) : undefined,
            )
          : undefined;
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
        step: 'queued',
        progressMessage: 'Đang chờ trong hàng đợi Google Flow…',
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
    if (this.running) {
      // Already orchestrating — still clear stop if user hit stop then start.
      this.stopFlag = false;
      return;
    }
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
      const next = this.pickNextPendingTask();
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
      } catch (fatal) {
        // Safety net: never leave a claimed task stuck in running forever
        const msg = fatal instanceof Error ? fatal.message : String(fatal);
        console.error(`[FlowQueue] w${workerId} fatal:`, msg.slice(0, 240));
        if (next.status === 'running' || next.status === 'pending') {
          next.status = 'failed';
          next.error = formatFlowTaskError(describeFlowError(undefined, msg));
          applyFlowTaskStep(next, 'error', { message: next.error });
        }
        if (next.accountId) markAccountFree(next.accountId);
      } finally {
        this.activeWorkers--;
      }
      if (this.stopFlag) break;
      // Standard jitter between tasks (anti rate-limit Google Labs)
      const delay =
        this.delayMin +
        Math.floor(Math.random() * (this.delayMax - this.delayMin + 1));
      await sleep(delay);
    }
  }

  /**
   * Prefer pending tasks that can run on a free Google account.
   * Standard: maxConcurrentTasksPerAccount = 1 (parallel = multi-account).
   * Claims task synchronously (status→running) to prevent double-pick.
   */
  private pickNextPendingTask(): FlowTask | undefined {
    const pending = this.tasks.filter((t) => t.status === 'pending');
    if (!pending.length) return undefined;
    const maxPer =
      Number(FLOW_DEFAULTS.maxConcurrentTasksPerAccount) > 0
        ? Number(FLOW_DEFAULTS.maxConcurrentTasksPerAccount)
        : 1;

    // If any account is free (not busy), still start — pickAccount will assign.
    // Block only when ALL verified accounts are busy AND we already have
    // activeWorkers covering them (avoid pile-up on one Labs session).
    if (maxPer > 0) {
      const verified = loadAccounts().filter(
        (a) => a.sessionVerified && a.email,
      );
      if (verified.length > 0) {
        const free = verified.filter((a) => !isAccountBusy(a.id));
        if (free.length === 0 && this.activeWorkers > 0) {
          return undefined; // wait for an account slot
        }
      }
    }

    const next = pending[0];
    // Atomic claim (sync) — must happen before any await in workerLoop
    next.status = 'running';
    next.updatedAt = Date.now();
    applyFlowTaskStep(next, 'account', {
      message: 'Đã nhận task — gắn profile Google Labs…',
    });
    return next;
  }

  /**
   * True if hard recycle would kill Chrome while more gens may still need this profile.
   * Pending tasks often have no accountId yet — treat unassigned pending carefully.
   */
  private hasMoreWorkForAccount(accountId: string): boolean {
    const assigned = this.tasks.some(
      (t) =>
        t.accountId === accountId &&
        (t.status === 'pending' || t.status === 'running'),
    );
    if (assigned) return true;

    const pendingUnassigned = this.tasks.filter(
      (t) => t.status === 'pending' && !t.accountId,
    );
    if (!pendingUnassigned.length) return false;

    const verified = loadAccounts().filter(
      (a) =>
        a.sessionVerified &&
        a.email &&
        !(a.cooldownUntil && a.cooldownUntil > Date.now()),
    );
    // Only this account (or none other free) → pending will land here
    if (verified.length <= 1) return true;
    const othersFree = verified.filter(
      (a) => a.id !== accountId && !isAccountBusy(a.id),
    );
    return othersFree.length === 0;
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
      // Critical: /api/queue/stop leaves stopFlag=true forever. runOne is a
      // direct single-shot path (generate-one / API gen video) and MUST clear it,
      // otherwise every task dies immediately with «Đã huỷ hàng đợi».
      this.stopFlag = false;
      // Stale busy lock (crashed/cancelled task) would spin 40×700ms then fail.
      for (const id of listBusyAccountIds()) markAccountFree(id);
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
    let accountSlotWaits = 0;
    /** Account held under busy lock for this attempt — always free in finally */
    let lockedAccountId: string | undefined;

    const releaseBusyLock = () => {
      if (lockedAccountId) {
        markAccountFree(lockedAccountId);
        lockedAccountId = undefined;
      }
    };

    try {
      for (let attempt = 1; attempt <= max; attempt++) {
        if (this.stopFlag) {
          task.status = 'cancelled';
          applyFlowTaskStep(task, 'error', {
            message: 'Đã huỷ hàng đợi Google Flow',
          });
          return;
        }
        task.attempts = attempt;
        task.status = 'running';
        applyFlowTaskStep(task, 'account');
        task.error = undefined;
        releaseBusyLock();

        const acc = this.pickAccountForTask(task);
        if (acc) {
          // Standard: 1 concurrent gen per Google account
          if (
            FLOW_DEFAULTS.maxConcurrentTasksPerAccount >= 1 &&
            isAccountBusy(acc.id)
          ) {
            accountSlotWaits += 1;
            if (accountSlotWaits > 40) {
              lastErr = `Timeout chờ slot account ${acc.name || acc.id} (max 1 gen/account).`;
              task.status = 'failed';
              applyFlowTaskStep(task, 'error', { message: lastErr });
              task.error = lastErr;
              return;
            }
            // Keep status running so another worker does not double-pick this task.
            // Do not assign accountId until slot is free (avoids false hasMoreWork).
            applyFlowTaskStep(task, 'queued', {
              message: `Chờ slot profile ${acc.name || acc.id}…`,
            });
            await sleep(700);
            attempt -= 1; // don't burn Google retry budget on lock wait
            continue;
          }
          accountSlotWaits = 0;
          task.accountId = acc.id;
          markAccountBusy(acc.id);
          lockedAccountId = acc.id;
          markAccountTaskUsed(acc.id);
          const tried =
            this.triedAccounts.get(task.id) || new Set<string>();
          tried.add(acc.id);
          this.triedAccounts.set(task.id, tried);
          console.log(
            `[FlowQueue] w${workerId} task→profile ${acc.name || acc.id} project=${acc.projectId || '—'}`,
          );
        }

        try {
          applyFlowTaskStep(task, 'submit');
          await this.executeTaskOnce(task);
          task.status = 'done';
          applyFlowTaskStep(task, 'done');
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
            const aid = task.accountId;
            // Free before recycle decision so busy check is accurate
            releaseBusyLock();
            scheduleFlowRuntimeRecycle({
              accountId: aid,
              kind: task.kind,
              hasMoreWorkForAccount: () => this.hasMoreWorkForAccount(aid),
            });
          }
          return;
        } catch (e) {
          lastErr = e instanceof Error ? e.message : String(e);
          const detail = describeFlowError(undefined, lastErr);
          const cat = detail.category;
          task.retryCategory = cat;
          task.error = formatFlowTaskError(detail);
          releaseBusyLock();
          if (cat === 'network' || cat === 'rate_429') {
            max = Math.min(max, FLOW_DEFAULTS.maxRetriesNetwork);
          }
          console.warn(
            `[FlowQueue] w${workerId} attempt ${attempt}/${max} fail [${cat}]:`,
            lastErr.slice(0, 200),
          );

          if (isPermanentFailure(cat, lastErr)) {
            console.error(
              `[FlowQueue] permanent failure — stop retry:`,
              lastErr.slice(0, 240),
            );
            task.status = 'failed';
            applyFlowTaskStep(task, 'error', {
              message: task.error,
            });
            if (task.accountId) {
              recordAccountTaskResult(task.accountId, false, 0);
            }
            return;
          }

          // Token / extension offline after recycle — refresh + conditional bootstrap
          if (cat === 'token_401' || cat === 'network') {
            try {
              const bridge = await import('./bridgeServer');
              await bridge.commandExtension(
                'refresh_flow_tab',
                {},
                60000,
                task.accountId,
              );
              await sleep(3000);
              const ops = loadFlowOps();
              const accRow = task.accountId
                ? loadAccounts().find((a) => a.id === task.accountId)
                : null;
              const msg = lastErr.toLowerCase();
              const looksOffline =
                msg.includes('socket offline') ||
                (msg.includes('extension') && msg.includes('offline')) ||
                msg.includes('browser dead') ||
                msg.includes('profile browser') ||
                msg.includes('econnrefused') ||
                msg.includes('not connected');
              // Avoid bootstrap storm on transient timeout: offline always, else attempt≥2
              const needBootstrap =
                (cat === 'network' && (looksOffline || attempt >= 2)) ||
                (cat === 'token_401' &&
                  ops.autoRelogin &&
                  accRow?.autoRelogin !== false &&
                  attempt >= 2);
              if (needBootstrap && task.accountId) {
                console.log(
                  '[FlowQueue] bootstrap after token/network fail for',
                  task.accountId,
                );
                const { bootstrapFlow } = await import('./bootstrap');
                await bootstrapFlow({
                  forceChrome: true,
                  engine: 'auto',
                  waitExtensionMs: 25000,
                  waitLoginMs: 15000,
                  accountId: task.accountId,
                  mode: 'background',
                });
              }
            } catch {
              /* ignore */
            }
          }

          if (task.accountId && (cat === 'quota' || cat === 'forbidden_403')) {
            updateAccount(task.accountId, {
              status: 'cooldown',
              cooldownUntil: Date.now() + FLOW_DEFAULTS.accountCooldownMs,
              lastError: lastErr.slice(0, 200),
            });
            recordAccountTaskResult(task.accountId, false, 0);
            task.accountId = undefined;
          }

          if (attempt < max) {
            // CRITICAL: keep status=running during backoff.
            // If we flip to pending, another worker can double-claim this task.
            applyFlowTaskStep(task, 'queued', {
              progress: Math.min(30, 10 + attempt * 5),
              message: `Thử lại (${attempt}/${max}): ${lastErr.slice(0, 80)}…`,
            });
            // Recover hung Flow tab before next captcha attempt
            if (
              cat === 'network' ||
              cat === 'token_401' ||
              /CAPTCHA|timeout|Extension API/i.test(lastErr)
            ) {
              try {
                const bridge = await import('./bridgeServer');
                await bridge.commandExtension(
                  'open_flow_tab',
                  { stealFocus: false, autoClick: true },
                  20_000,
                  task.accountId,
                );
                await sleep(1200);
                await bridge.commandExtension(
                  'refresh_flow_tab',
                  {},
                  45_000,
                  task.accountId,
                );
                await sleep(2000);
              } catch {
                /* best-effort */
              }
            }
            await sleep(FLOW_DEFAULTS.retryDelayMs);
          }
        }
      }

      task.status = 'failed';
      if (lastErr) {
        task.error = formatFlowTaskError(describeFlowError(undefined, lastErr));
      } else {
        task.error = 'Max retries exceeded';
      }
      if (task.accountId) {
        recordAccountTaskResult(task.accountId, false, 0);
      }
      applyFlowTaskStep(task, 'error', { message: task.error });
    } finally {
      releaseBusyLock();
    }
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
    const maxPer = Number(FLOW_DEFAULTS.maxConcurrentTasksPerAccount) || 1;
    // Prefer not-yet-tried ready accounts — health + budget + lastTaskAt
    // Standard: skip accounts currently genning (1 captcha/session at a time)
    const fresh = accounts.filter(
      (a) =>
        !tried.has(a.id) &&
        a.sessionVerified &&
        a.email &&
        !(maxPer >= 1 && isAccountBusy(a.id)) &&
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
    // Fallback: ignore health floor but still respect budget + busy lock
    const budgeted = accounts.filter(
      (a) =>
        !tried.has(a.id) &&
        a.sessionVerified &&
        a.email &&
        !(maxPer >= 1 && isAccountBusy(a.id)) &&
        accountWithinBudget(a, need),
    );
    if (budgeted.length) {
      budgeted.sort((a, b) => (a.lastTaskAt || 0) - (b.lastTaskAt || 0));
      return budgeted[0];
    }
    // Last resort: may return a busy account → caller waits for slot
    const anyReady = pickReadyAccount(accounts);
    if (anyReady && maxPer >= 1 && isAccountBusy(anyReady.id)) {
      // Prefer a free verified account even if health/budget edge
      const free = accounts.find(
        (a) =>
          a.sessionVerified &&
          a.email &&
          !isAccountBusy(a.id) &&
          !(a.cooldownUntil && a.cooldownUntil > Date.now()),
      );
      if (free) return free;
    }
    return anyReady;
  }

  private async executeTaskOnce(task: FlowTask): Promise<void> {
    const bridge = await import('./bridgeServer');
    await bridge.ensureBridgeStarted();

    // After hard recycle, Chromium may be dead — relaunch profile before gen
    if (task.accountId) {
      try {
        const { isProfileBrowserAlive, profileDirForAccount } = await import(
          './chromeSession'
        );
        const dir = profileDirForAccount(task.accountId);
        if (dir && !isProfileBrowserAlive(dir)) {
          console.log(
            `[FlowQueue] profile browser dead after recycle — bootstrap ${task.accountId}`,
          );
          const { bootstrapFlow } = await import('./bootstrap');
          await bootstrapFlow({
            forceChrome: true,
            engine: 'auto',
            waitExtensionMs: 25_000,
            waitLoginMs: 12_000,
            accountId: task.accountId,
            mode: 'background',
          });
        }
      } catch (bootErr) {
        console.warn(
          '[FlowQueue] post-recycle bootstrap failed:',
          bootErr instanceof Error ? bootErr.message : bootErr,
        );
      }
    }

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
    const referencePaths: string[] = [];
    const addReference = (raw?: string) => {
      const resolved = resolveLocalImage(raw);
      if (resolved && !referencePaths.includes(resolved)) {
        referencePaths.push(resolved);
      }
    };
    addReference(task.referenceImagePath);
    for (const ingredientPath of task.ingredientPaths || []) {
      if (referencePaths.length >= 3) break;
      addReference(ingredientPath);
    }
    const refPath = referencePaths[0] || null;
    // A supplied face/cast ref is part of the requested identity lock. If its
    // upload fails, hard-fail instead of silently producing a text-only result.
    if (referencePaths.length) {
      applyFlowTaskStep(task, 'submit', {
        progress: 12,
        message: 'Nén + upload ảnh ref / identity lock…',
      });
      try {
        const mediaIds: string[] = [];
        for (const localReference of referencePaths) {
          const mid = await this.uploadLocalImage(
            localReference,
            projectId,
            bridge,
            task.accountId,
          );
          if (mid && !mediaIds.includes(mid)) mediaIds.push(mid);
        }
        if (mediaIds.length) imageMediaIds = mediaIds;
        applyFlowTaskStep(task, 'submit', {
          progress: 22,
          message: 'Đã upload ref — chuẩn bị gen ảnh…',
        });
      } catch (upErr) {
        throw new Error(
          `Upload ảnh ref thất bại (identity lock). Nén/ffmpeg + extension: ${
            upErr instanceof Error ? upErr.message : String(upErr)
          }`,
        );
      }
    }

    // Face-lock inject inside buildImageGenerateBody (FlowAgent stage 3)
    // edit kind: base ref + edit prompt (P1 object/light edit via re-gen)
    applyFlowTaskStep(task, 'submit', {
      progress: 35,
      message: 'Gửi gen ảnh Google Flow…',
    });
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

    // Warm Flow tab so grecaptcha + page XHR are ready (cuts CAPTCHA_TIMEOUT).
    // Also clears google.com/sorry (restore window + auto-click + wait human).
    applyFlowTaskStep(task, 'captcha', {
      progress: 34,
      message: 'Mở Flow + xử lý chặn bot Google (nếu có)…',
    });
    try {
      const chRes = await bridge.commandExtension(
        'resolve_google_challenge',
        { timeoutMs: 180_000, autoClick: true },
        200_000,
        task.accountId,
      );
      if (chRes?.error && /GOOGLE_CHALLENGE|SORRY/i.test(String(chRes.error))) {
        throw new Error(String(chRes.error));
      }
      if (chRes?.result && (chRes.result as { resolved?: boolean }).resolved) {
        applyFlowTaskStep(task, 'captcha', {
          progress: 38,
          message: 'Đã vượt trang chặn bot — làm nóng tab Flow…',
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/GOOGLE_CHALLENGE|SORRY/i.test(msg)) throw new Error(msg);
      /* extension offline / method missing — continue open_flow_tab */
    }
    try {
      const openRes = await bridge.commandExtension(
        'open_flow_tab',
        {
          challengeTimeoutMs: 180_000,
          autoClick: true,
          // Do not steal OS focus every image gen (only /sorry/ path focuses)
          stealFocus: false,
        },
        200_000,
        task.accountId,
      );
      if (openRes?.error && /GOOGLE_CHALLENGE/i.test(String(openRes.error))) {
        throw new Error(String(openRes.error));
      }
      await sleep(800);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/GOOGLE_CHALLENGE/i.test(msg)) throw new Error(msg);
      /* tab may already exist */
    }

    applyFlowTaskStep(task, 'captcha', {
      progress: 42,
      message: 'Xác minh reCAPTCHA + gửi gen ảnh…',
    });
    const res = await bridge.requestViaExtension({
      url: gen.url,
      method: 'POST',
      headers: buildBrowserHeaders(),
      body: gen.body,
      captchaAction: gen.captchaAction,
      // Extension page XHR budget ~160s + captcha + optional /sorry/ wait
      timeoutMs: 260_000,
      accountId: task.accountId,
    });

    if (res.error || (res.status && res.status >= 400)) {
      throw new Error(
        res.error ||
          `Image gen HTTP ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}`,
      );
    }

    applyFlowTaskStep(task, 'download', { progress: 70 });
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
    const { prepareFlowUploadImage } = await import('./promptInjector');
    const prepared = prepareFlowUploadImage(absPath);
    const { base64, mimeType, byteLength } = prepared;
    if (prepared.compressed) {
      console.log(
        `[FlowQueue] Upload using compressed still ${byteLength}B (was large PNG/ref)`,
      );
    } else if (byteLength > 2_500_000) {
      console.warn(
        `[FlowQueue] Large upload ${byteLength} bytes — may timeout on WS`,
      );
    }
    const {
      buildUploadImageCandidates,
      extractUploadMediaId,
    } = await import('./payloadBuilder');
    const fileName =
      path.basename(prepared.path || absPath).replace(/\.\w+$/i, '') +
      (mimeType.includes('jpeg') || mimeType.includes('jpg') ? '.jpg' : '.png');
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
    // Prefer FlowAgent shapes first; allow 3 shapes after compress (was 2 → early give-up).
    // 4× long timeouts still bad — cap shapes, raise per-try timeout for flaky SW.
    const shapeBudget = prepared.compressed
      ? Math.min(allCandidates.length, 3)
      : Math.max(1, Math.min(FLOW_DEFAULTS.maxUploadShapes, 3));
    const candidates = allCandidates.slice(0, shapeBudget);
    // Body stashed over HTTP; SW fetch can stall — prefer fail-fast + re-warm over 3×180s hang.
    // Compressed ~70KB still needs live extension socket (live: disconnect mid-upload → 180s dead air).
    const timeoutMs = prepared.compressed ? 100_000 : 140_000;
    const errors: string[] = [];

    const warmExtensionForUpload = async (why: string) => {
      try {
        const snap = bridge.getBridgeSnapshot?.() as
          | {
              extensionConnected?: boolean;
              accounts?: Array<{
                id?: string;
                extensionConnected?: boolean;
              }>;
            }
          | undefined;
        const aid = String(accountId || '').trim();
        const acc = (snap?.accounts || []).find((a) => a.id === aid);
        const extOk = Boolean(
          acc?.extensionConnected || snap?.extensionConnected,
        );
        if (!extOk) {
          console.warn(
            `[FlowQueue] Extension offline before upload (${why}) — open_flow_tab`,
          );
        }
        await bridge.commandExtension(
          'open_flow_tab',
          { stealFocus: false, autoClick: true },
          25_000,
          accountId,
        );
        await sleep(extOk ? 800 : 2000);
      } catch (e) {
        console.warn(
          `[FlowQueue] warmExtensionForUpload failed (${why}):`,
          e instanceof Error ? e.message : e,
        );
      }
    };

    await warmExtensionForUpload('pre-upload');

    for (const upload of candidates) {
      // Re-warm every shape — extension often drops after long image gen / idle
      await warmExtensionForUpload(upload.label);
      try {
        console.log(
          `[FlowQueue] Upload try ${upload.label} keys=${Object.keys(upload.body).join(',')} bytes=${byteLength} compressed=${prepared.compressed} timeout=${timeoutMs}`,
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
        // Timeout / socket: re-warm then next shape (do not burn 9+ min silent)
        if (/timeout|offline|socket|disconnect|không gửi/i.test(em)) {
          console.warn(
            `[FlowQueue] Upload fail on ${upload.label} (${em.slice(0, 80)}) — re-warm + next shape`,
          );
          await warmExtensionForUpload(`after-fail:${upload.label}`);
          continue;
        }
      }
    }

    throw new Error(
      `Upload failed (tried ${candidates.length}/${allCandidates.length} shapes` +
        `${prepared.compressed ? ', compressed' : ''}). ` +
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
          timeoutMs: 200_000,
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

    // Dual stills (Start+End = 2 ảnh liền kề) → I2V first+last, never R2V.
    const startPathEarly = resolveLocalImage(
      task.startImagePath || task.referenceImagePath,
    );
    const endPathEarly = resolveLocalImage(task.endImagePath);
    const dualI2vStills = Boolean(
      startPathEarly && endPathEarly && startPathEarly !== endPathEarly,
    );

    // P0 Ingredients / R2V — only when mode=ingredients AND not dual first+last stills
    if (
      !resEarly &&
      !dualI2vStills &&
      (vMode === 'ingredients' || (task.ingredientPaths?.length || 0) > 0)
    ) {
      const paths: string[] = [];
      const pushUnique = (p?: string | null) => {
        const r = resolveLocalImage(p || undefined);
        if (r && !paths.includes(r)) paths.push(r);
      };
      for (const pp of task.ingredientPaths || []) pushUnique(pp);
      if (vMode === 'ingredients') {
        pushUnique(task.startImagePath);
        pushUnique(task.referenceImagePath);
      }
      const uiFam = detectVideoModelFamily(task.videoModel);
      // R2V only with reference-family UI model (or empty → default r2v key).
      // I2V/Omni/T2V UI never enter ReferenceImages endpoint (B10).
      const wantR2v =
        vMode === 'ingredients' &&
        paths.length >= 1 &&
        (uiFam === 'reference' || uiFam === 'unknown');
      if (wantR2v) {
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
              timeoutMs: 200_000,
              accountId: task.accountId,
            });
            if (resEarly.error || (resEarly.status && resEarly.status >= 400)) {
              lastVidErrEarly =
                resEarly.error ||
                `HTTP ${resEarly.status}: ${JSON.stringify(resEarly.data).slice(0, 200)}`;
              resEarly = null;
              // Fall through I2V start-only — never invent end from ingredient list
              startMediaId = mediaIds[0];
            }
          } catch (e) {
            lastVidErrEarly = e instanceof Error ? e.message : String(e);
            resEarly = null;
            startMediaId = mediaIds[0];
          }
        }
      }
    }

    const startPath = startPathEarly;
    if (startPath && !startMediaId && !resEarly) {
      applyFlowTaskStep(task, 'submit', {
        progress: 10,
        message: dualI2vStills
          ? 'Nén + upload ảnh start (I2V first+last)…'
          : 'Nén + upload ảnh start (I2V)…',
      });
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
      applyFlowTaskStep(task, 'submit', {
        progress: 18,
        message: 'Đã upload ảnh start — gửi gen video…',
      });
    }

    const endPath = resolveLocalImage(task.endImagePath);
    if (endPath && !endMediaId && !resEarly) {
      applyFlowTaskStep(task, 'submit', {
        progress: 16,
        message: 'Nén + upload ảnh end (first+last)…',
      });
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
      applyFlowTaskStep(task, 'submit', {
        progress: 12,
        message: 'Chuẩn bị gen video T2V…',
      });
      // Clear error when UI model is R2V/I2V but no start frame → pure T2V needs T2V model
      try {
        const fam = detectVideoModelFamily(task.videoModel);
        if (fam === 'reference' || fam === 'i2v' || fam === 'extend') {
          throw new Error(
            `MODEL_MISMATCH: Đang gen video không có ảnh start (T2V) nhưng model UI «${task.videoModel}» thuộc nhánh ${fam.toUpperCase()}. ` +
              `Vào Cấu hình Ảnh/Video chọn model T2V (vd. veo_3_1_t2v_fast), hoặc gen ảnh trước rồi Nối video (I2V).`,
          );
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('MODEL_MISMATCH')) throw e;
      }
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
      applyFlowTaskStep(task, 'captcha', {
        progress: 16,
        message: 'Mở Flow + xử lý chặn bot Google (video)…',
      });
      // Quick probe first (no_challenge returns instantly). Full 180s only if
      // a /sorry/ tab is present — avoids 200s hang when extension is offline.
      try {
        const chRes = await bridge.commandExtension(
          'resolve_google_challenge',
          { timeoutMs: 25_000, autoClick: true },
          35_000,
          task.accountId,
        );
        if (chRes?.error && /GOOGLE_CHALLENGE|SORRY/i.test(String(chRes.error))) {
          // Real challenge still open — give human more time once
          const longCh = await bridge.commandExtension(
            'resolve_google_challenge',
            { timeoutMs: 150_000, autoClick: true },
            160_000,
            task.accountId,
          );
          if (
            longCh?.error &&
            /GOOGLE_CHALLENGE|SORRY/i.test(String(longCh.error))
          ) {
            throw new Error(String(longCh.error));
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/GOOGLE_CHALLENGE|SORRY/i.test(msg)) throw new Error(msg);
        if (/offline|timeout/i.test(msg)) {
          throw new Error(
            `Extension offline/timeout trước gen video T2V: ${msg}`,
          );
        }
      }
      try {
        const openRes = await bridge.commandExtension(
          'open_flow_tab',
          {
            challengeTimeoutMs: 30_000,
            autoClick: true,
            stealFocus: false,
          },
          45_000,
          task.accountId,
        );
        if (openRes?.error && /GOOGLE_CHALLENGE/i.test(String(openRes.error))) {
          throw new Error(String(openRes.error));
        }
        await sleep(400);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/GOOGLE_CHALLENGE/i.test(msg)) throw new Error(msg);
        /* tab may already exist — continue to captcha+submit */
      }
      // FlowAgent emits this exact browser event immediately before T2V.
      // Google uses it in the normal reCAPTCHA/risk-evaluation request flow.
      const telemetry = buildVideoFrontendTelemetryBody({
        projectId,
        prompt: task.prompt,
        aspectRatio: task.aspectRatio,
        videoModelKey: resolvedT2v,
        outputCount: 1,
      });
      try {
        const telemetryRes = await bridge.requestViaExtension({
          url: telemetry.url,
          method: 'POST',
          headers: buildBrowserHeaders(),
          body: telemetry.body,
          timeoutMs: 30_000,
          accountId: task.accountId,
        });
        if (
          telemetryRes.error ||
          (telemetryRes.status && telemetryRes.status >= 400)
        ) {
          console.warn(
            '[FlowQueue] T2V frontend telemetry rejected',
            telemetryRes.error || telemetryRes.status,
          );
        } else {
          console.log(
            `[FlowQueue] T2V frontend telemetry accepted status=${telemetryRes.status || 200}`,
          );
        }
      } catch (error) {
        // FlowAgent treats telemetry as best-effort, then lets the real
        // generation response remain the authoritative pass/fail signal.
        console.warn(
          '[FlowQueue] T2V frontend telemetry failed',
          error instanceof Error ? error.message : String(error),
        );
      }
      applyFlowTaskStep(task, 'captcha', {
        progress: 40,
        message: 'reCAPTCHA + gửi gen video T2V…',
      });
      const t2vRes = await bridge.requestViaExtension({
        url: gen.url,
        method: 'POST',
        headers: buildBrowserHeaders(),
        body: gen.body,
        captchaAction: 'VIDEO_GENERATION',
        timeoutMs: 200_000,
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

    applyFlowTaskStep(task, resEarly ? 'poll' : 'submit', {
      progress: resEarly ? 40 : 25,
      message: resEarly
        ? 'Google đã nhận job — đang poll…'
        : 'Gửi gen video Google Flow…',
    });

    let res: Awaited<ReturnType<typeof bridge.requestViaExtension>> | null =
      resEarly;
    let lastVidErr = lastVidErrEarly || '';
    if (res) {
      console.log('[FlowQueue] Using EXTEND/INGREDIENTS/T2V response');
    } else if (startMediaId) {
      // Warm Flow tab before VIDEO_GENERATION captcha (same as T2V/image).
      // Without this, cold/minimized tabs often return reCAPTCHA evaluation 403.
      applyFlowTaskStep(task, 'captcha', {
        progress: 20,
        message: 'Mở Flow + reCAPTCHA trước gen video I2V…',
      });
      try {
        await bridge.commandExtension(
          'resolve_google_challenge',
          { timeoutMs: 20_000, autoClick: true },
          30_000,
          task.accountId,
        );
      } catch {
        /* continue — captcha step will re-check */
      }
      try {
        await bridge.commandExtension(
          'open_flow_tab',
          {
            challengeTimeoutMs: 25_000,
            autoClick: true,
            stealFocus: false,
          },
          40_000,
          task.accountId,
        );
        await sleep(500);
      } catch {
        /* tab may already exist */
      }
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
          timeoutMs: 200_000,
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
      applyFlowTaskStep(task, 'poll', {
        progress: Math.min(85, 40 + polls),
        message: `Google đang render video… (poll ${polls})`,
      });

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
            timeoutMs: 200_000,
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
        applyFlowTaskStep(task, 'download', {
          progress: 90,
          message: 'Tải video từ Google…',
        });
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
