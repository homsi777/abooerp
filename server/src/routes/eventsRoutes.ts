import { Router } from 'express';
import { requirePermissions } from '../middleware/authorization.js';
import { eventBus } from '../events/eventBus.js';

export function createEventsRouter() {
  const router = Router();

  /**
   * SSE stream — clients connect and receive push events in real-time.
   * Each client is scoped to their company and optional branch.
   */
  router.get(
    '/stream',
    requirePermissions([]),
    (req, res) => {
      const ctx = (req as any).requestUserContext;
      const companyId = ctx?.companyId as string | undefined;
      const branchId = ctx?.branchId as string | null | undefined;

      if (!companyId) {
        res.status(403).json({ success: false, error: 'Company scope required.' });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      // Send initial heartbeat so client knows stream is alive
      res.write(`data: ${JSON.stringify({ type: 'connected', companyId, timestamp: new Date().toISOString() })}\n\n`);

      const remove = eventBus.addClient({ res, companyId, branchId: branchId ?? null });

      // Heartbeat every 25 seconds to prevent proxy timeouts
      const heartbeat = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          clearInterval(heartbeat);
        }
      }, 25_000);

      req.on('close', () => {
        clearInterval(heartbeat);
        remove();
      });
    },
  );

  return router;
}
