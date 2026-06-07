/** Singleton in-process SSE event bus. */
class EventBus {
    clients = new Set();
    addClient(client) {
        this.clients.add(client);
        return () => this.clients.delete(client);
    }
    broadcast(event) {
        const payload = `data: ${JSON.stringify(event)}\n\n`;
        const dead = [];
        for (const client of this.clients) {
            if (client.companyId !== event.companyId)
                continue;
            if (event.branchId && client.branchId && client.branchId !== event.branchId)
                continue;
            try {
                client.res.write(payload);
                if (typeof client.res.flush === 'function') {
                    client.res.flush();
                }
            }
            catch {
                dead.push(client);
            }
        }
        for (const d of dead)
            this.clients.delete(d);
    }
    get clientCount() {
        return this.clients.size;
    }
}
export const eventBus = new EventBus();
/** Convenience helper — call after any successful mutation. */
export function emit(event) {
    setImmediate(() => eventBus.broadcast(event));
}
