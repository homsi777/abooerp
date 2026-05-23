import type { Response } from 'express';

export type AppEventType =
  | 'shipment.created'
  | 'shipment.updated'
  | 'shipment.deleted'
  | 'delivery.updated'
  | 'manifest.updated'
  | 'voucher.created'
  | 'inventory.stock.updated'
  | 'printer.route.updated'
  | 'settings.updated';

export interface AppEvent {
  type: AppEventType;
  companyId: string;
  branchId?: string | null;
  entityId?: string | null;
  timestamp: string;
  correlationId?: string | null;
}

interface SseClient {
  res: Response;
  companyId: string;
  branchId?: string | null;
}

/** Singleton in-process SSE event bus. */
class EventBus {
  private clients: Set<SseClient> = new Set();

  addClient(client: SseClient): () => void {
    this.clients.add(client);
    return () => this.clients.delete(client);
  }

  broadcast(event: AppEvent): void {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    const dead: SseClient[] = [];

    for (const client of this.clients) {
      if (client.companyId !== event.companyId) continue;
      if (event.branchId && client.branchId && client.branchId !== event.branchId) continue;

      try {
        client.res.write(payload);
        if (typeof (client.res as any).flush === 'function') {
          (client.res as any).flush();
        }
      } catch {
        dead.push(client);
      }
    }

    for (const d of dead) this.clients.delete(d);
  }

  get clientCount(): number {
    return this.clients.size;
  }
}

export const eventBus = new EventBus();

/** Convenience helper — call after any successful mutation. */
export function emit(event: AppEvent): void {
  setImmediate(() => eventBus.broadcast(event));
}
