// Build change events: one in-process bus, served to clients as server-sent events.
import { EventEmitter } from "node:events";
import type { Request, Response } from "express";

export interface BuildEvent {
  revision: number;
  cause: string;
  changedStats: Record<string, { before: number | null; after: number | null }>;
}

export class Events {
  private readonly bus = new EventEmitter();

  constructor() {
    this.bus.setMaxListeners(0);
  }

  emit(buildId: string, ev: BuildEvent): void {
    this.bus.emit(buildId, ev);
  }

  subscribe(buildId: string, fn: (ev: BuildEvent) => void): () => void {
    this.bus.on(buildId, fn);
    return () => this.bus.off(buildId, fn);
  }

  /** Streams a build's events; the first frame is the current revision so a client knows where it stands. */
  serve(buildId: string, currentRevision: number, req: Request, res: Response): void {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", "x-accel-buffering": "no" });
    const write = (event: string, data: unknown, id?: number) =>
      res.write(`${id !== undefined ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    write("hello", { revision: currentRevision }, currentRevision);
    const off = this.subscribe(buildId, (ev) => write(ev.cause === "delete" ? "deleted" : "change", ev, ev.revision));
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(ping);
      off();
    });
  }
}
