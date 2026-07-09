import { subscribeEngineBus, type EngineBusEvent } from '@/lib/novel-engine/bus';
import { getRunnerStatus } from '@/lib/novel-engine/runner';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const encoder = new TextEncoder();
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: EngineBusEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // client gone
        }
      };

      send({ type: 'status', status: getRunnerStatus() });
      send({
        type: 'log',
        message: 'SSE native engine connected (không proxy 8080).',
        level: 'success',
      });

      const unsub = subscribeEngineBus(send);
      const heartbeat = setInterval(() => {
        send({ type: 'ping' });
      }, 15000);

      cleanup = () => {
        clearInterval(heartbeat);
        unsub();
      };
    },
    cancel() {
      if (cleanup) cleanup();
      cleanup = null;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
