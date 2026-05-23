function normalizeHeaderValue(value) {
    if (!value)
        return undefined;
    if (Array.isArray(value))
        return value[0];
    return value;
}
export function parseDataScope(req) {
    const requestInjectedScope = req.requestScope;
    if (requestInjectedScope?.branchId || requestInjectedScope?.agentId) {
        return requestInjectedScope;
    }
    const branchIdFromHeader = normalizeHeaderValue(req.headers['x-branch-id']);
    const agentIdFromHeader = normalizeHeaderValue(req.headers['x-agent-id']);
    const branchIdFromQuery = typeof req.query.branchId === 'string' ? req.query.branchId : undefined;
    const agentIdFromQuery = typeof req.query.agentId === 'string' ? req.query.agentId : undefined;
    return {
        branchId: branchIdFromHeader ?? branchIdFromQuery,
        agentId: agentIdFromHeader ?? agentIdFromQuery,
    };
}
