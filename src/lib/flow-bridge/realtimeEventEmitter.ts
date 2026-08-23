/**
 * Real-time Task Progress Event Emitter for AI Novel.
 * Exact reference implementation from SuperAutoTools.
 *
 * Broadcasts task progress (0-100%), rendering steps, incremental scene downloads,
 * and status updates to the UI in real-time.
 */

import { EventEmitter } from 'node:events';

export interface TaskProgressEvent {
  jobId: string;
  sceneId?: string;
  progress: number;
  step: string;
  message: string;
  localPath?: string;
  timestamp: number;
}

class RealtimeEventEmitter extends EventEmitter {
  emitProgress(event: Omit<TaskProgressEvent, 'timestamp'>) {
    const payload: TaskProgressEvent = {
      ...event,
      timestamp: Date.now(),
    };
    console.log(`[RealtimeEvents] [Job ${payload.jobId}] ${payload.progress}% - ${payload.message}`);
    this.emit('task_progress', payload);
  }

  onProgress(handler: (event: TaskProgressEvent) => void) {
    this.on('task_progress', handler);
    return () => this.off('task_progress', handler);
  }
}

export const realtimeEvents = new RealtimeEventEmitter();
