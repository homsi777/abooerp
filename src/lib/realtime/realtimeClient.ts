/**
 * SSE realtime client.
 * Connects to /api/v1/events/stream and delivers typed app events to subscribers.
 * Handles auto-reconnect with exponential backoff.
 */

export type AppEventType =
  | 'shipment.created'
  | 'shipment.updated'
  | 'shipment.deleted'
  | 'delivery.updated'
  | 'manifest.updated'
  | 'voucher.created'
  | 'inventory.stock.updated'
  | 'printer.route.updated'
  | 'settings.updated'
  | 'connected';

export interface AppEvent {
  type: AppEventType;
  companyId?: string;
  branchId?: string | null;
  entityId?: string | null;
  timestamp?: string;
  correlationId?: string | null;
}

type Listener = (event: AppEvent) => void;

const MIN_BACKOFF_MS  = 1_000;
const MAX_BACKOFF_MS  = 30_000;
const BACKOFF_FACTOR  = 2;

class RealtimeClient {
  private es: EventSource | null = null;
  private listeners: Map<AppEventType | '*', Set<Listener>> = new Map();
  private backoff = MIN_BACKOFF_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private apiBase = '';
  private getToken: (() => string | null) | null = null;

  /** Call once after login is confirmed. */
  connect(apiBase: string, getToken: () => string | null): void {
    this.apiBase   = apiBase;
    this.getToken  = getToken;
    this.active    = true;
    this.backoff   = MIN_BACKOFF_MS;
    this._open();

    window.addEventListener('online',  this._onOnline);
    window.addEventListener('offline', this._onOffline);
  }

  disconnect(): void {
    this.active = false;
    this._close();
    window.removeEventListener('online',  this._onOnline);
    window.removeEventListener('offline', this._onOffline);
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  subscribe(eventType: AppEventType | '*', listener: Listener): () => void {
    if (!this.listeners.has(eventType)) this.listeners.set(eventType, new Set());
    this.listeners.get(eventType)!.add(listener);
    return () => this.listeners.get(eventType)?.delete(listener);
  }

  private _open() {
    if (!this.active) return;
    this._close();

    const token  = this.getToken?.() ?? '';
    const url    = `${this.apiBase}/events/stream`;

    // SSE doesn't support custom headers natively, pass token via query param
    const src = new EventSource(`${url}?t=${encodeURIComponent(token)}`);

    src.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as AppEvent;
        this.backoff = MIN_BACKOFF_MS;
        this._emit(ev);
      } catch { /* ignore malformed */ }
    };

    src.onerror = () => {
      src.close();
      this._scheduleRetry();
    };

    this.es = src;
  }

  private _close() {
    this.es?.close();
    this.es = null;
  }

  private _scheduleRetry() {
    if (!this.active) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this._open();
    }, this.backoff);
    this.backoff = Math.min(this.backoff * BACKOFF_FACTOR, MAX_BACKOFF_MS);
  }

  private _emit(event: AppEvent) {
    const specific = this.listeners.get(event.type);
    const wildcard = this.listeners.get('*');
    specific?.forEach(fn => fn(event));
    wildcard?.forEach(fn => fn(event));
  }

  private _onOnline  = () => { this.backoff = MIN_BACKOFF_MS; this._open(); };
  private _onOffline = () => { this._close(); };
}

export const realtimeClient = new RealtimeClient();
