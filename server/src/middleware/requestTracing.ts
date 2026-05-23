import type { NextFunction, Request, Response } from 'express';

export function requestTracingMiddleware(req: Request, res: Response, next: NextFunction) {
  const startedAt = Date.now();
  const correlationId = (req as any).correlationId as string | undefined;
  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    console.info(
      JSON.stringify({
        type: 'http_request',
        correlationId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs,
      })
    );
  });
  next();
}
