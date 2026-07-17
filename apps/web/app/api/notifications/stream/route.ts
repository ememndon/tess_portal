import { apiUser } from "@/lib/server/auth";
import { notifyBus, unreadCount } from "@/lib/server/notify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Live notification stream over Server-Sent Events. */
export async function GET(req: Request) {
  const user = await apiUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const bus = notifyBus();
  const initialUnread = await unreadCount(user.id);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          // stream already closed
        }
      };
      send(JSON.stringify({ unread: initialUnread }));
      const onEvent = (message: string) => send(message);
      bus.on(user.id, onEvent);
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          // stream already closed
        }
      }, 25000);
      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        bus.off(user.id, onEvent);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
