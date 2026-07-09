/**
 * In-process event bus for SSE clients (engine logs / status).
 */

export type EngineBusEvent =
  | { type: 'log'; message: string; level?: 'info' | 'error' | 'success' }
  | { type: 'status'; status: 'running' | 'stopped' }
  | { type: 'chapter_update'; chapterId?: number }
  | { type: 'ping' };

type Listener = (event: EngineBusEvent) => void;

const g = globalThis as unknown as {
  __ainovelBus?: {
    listeners: Set<Listener>;
  };
};

function bus() {
  if (!g.__ainovelBus) {
    g.__ainovelBus = { listeners: new Set() };
  }
  return g.__ainovelBus;
}

export function subscribeEngineBus(listener: Listener): () => void {
  bus().listeners.add(listener);
  return () => {
    bus().listeners.delete(listener);
  };
}

export function emitEngineBus(event: EngineBusEvent): void {
  for (const listener of bus().listeners) {
    try {
      listener(event);
    } catch {
      // ignore dead listeners
    }
  }
}

export function logEngine(
  message: string,
  level: 'info' | 'error' | 'success' = 'info',
): void {
  emitEngineBus({ type: 'log', message, level });
}
