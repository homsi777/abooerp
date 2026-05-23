import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers['x-correlation-id'];
  const incoming = Array.isArray(header) ? header[0] : header;
  const correlationId = incoming?.trim() || randomUUID();
  (req as any).correlationId = correlationId;
  res.setHeader('x-correlation-id', correlationId);
  next();
}
