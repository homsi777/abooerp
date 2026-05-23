import { randomUUID } from 'node:crypto';
export function correlationIdMiddleware(req, res, next) {
    const header = req.headers['x-correlation-id'];
    const incoming = Array.isArray(header) ? header[0] : header;
    const correlationId = incoming?.trim() || randomUUID();
    req.correlationId = correlationId;
    res.setHeader('x-correlation-id', correlationId);
    next();
}
