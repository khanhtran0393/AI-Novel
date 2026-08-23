/**
 * Durable Task Queue & Crash Rehydration for AI Novel.
 * Exact reference implementation from SuperAutoTools.
 *
 * Saves job state transitions to persistent disk storage (`data/queue_state.json`).
 * On app restart, `restoreState()` rehydrates running jobs so interrupted generations
 * can be polled and completed seamlessly without losing data.
 */

import fs from 'node:fs';
import path from 'node:path';

export type JobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'RETRYABLE';

export interface DurableJob {
  id: string;
  kind: 'video' | 'image' | 'upsample' | 'edit';
  prompt: string;
  accountId: string;
  profileId: string;
  status: JobStatus;
  progress: number;
  operationName?: string;
  mediaId?: string;
  outputUrls?: string[];
  localPath?: string;
  retryCount: number;
  maxRetries: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

class DurableQueueEngine {
  private jobs = new Map<string, DurableJob>();
  private storagePath: string;

  constructor() {
    this.storagePath = path.resolve(process.cwd(), 'data', 'queue_state.json');
    this.ensureDirectory();
    this.restoreState();
  }

  private ensureDirectory(): void {
    const dir = path.dirname(this.storagePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  public restoreState(): void {
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf8');
        const data: DurableJob[] = JSON.parse(raw);
        this.jobs.clear();
        for (const job of data) {
          // Rehydrate PROCESSING jobs to RETRYABLE so poller can resume
          if (job.status === 'PROCESSING') {
            job.status = 'RETRYABLE';
            job.updatedAt = Date.now();
          }
          this.jobs.set(job.id, job);
        }
        console.log(`[DurableQueue] Restored ${this.jobs.size} jobs from persistent storage`);
      }
    } catch (e: any) {
      console.warn('[DurableQueue] Failed to restore state:', e?.message || e);
    }
  }

  public persistState(): void {
    try {
      const data = Array.from(this.jobs.values());
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e: any) {
      console.warn('[DurableQueue] Failed to persist state:', e?.message || e);
    }
  }

  public enqueueJob(job: Omit<DurableJob, 'status' | 'progress' | 'retryCount' | 'createdAt' | 'updatedAt'>): DurableJob {
    const fullJob: DurableJob = {
      ...job,
      status: 'PENDING',
      progress: 0,
      retryCount: 0,
      maxRetries: job.maxRetries ?? 10,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.jobs.set(fullJob.id, fullJob);
    this.persistState();
    return fullJob;
  }

  public updateJobStatus(id: string, updates: Partial<DurableJob>): DurableJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    Object.assign(job, updates, { updatedAt: Date.now() });
    this.persistState();
    return job;
  }

  public getJob(id: string): DurableJob | undefined {
    return this.jobs.get(id);
  }

  public listPendingJobs(): DurableJob[] {
    return Array.from(this.jobs.values()).filter(
      (j) => j.status === 'PENDING' || j.status === 'RETRYABLE',
    );
  }

  public listAllJobs(): DurableJob[] {
    return Array.from(this.jobs.values());
  }
}

export const durableQueue = new DurableQueueEngine();
