export function requestTracingMiddleware(req, res, next) {
    const startedAt = Date.now();
    const correlationId = req.correlationId;
    res.on('finish', () => {
        const durationMs = Date.now() - startedAt;
        console.info(JSON.stringify({
            type: 'http_request',
            correlationId,
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            durationMs,
        }));
    });
    next();
}
