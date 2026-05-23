import { pool } from '../db/pool.js';
import { AuditRepository } from '../repositories/auditRepository.js';
const MAX_METADATA_BYTES = 8 * 1024;
function normalizeAction(action) {
    return action.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
}
function sanitizeMetadata(input) {
    if (!input)
        return {};
    const safe = {};
    for (const [key, value] of Object.entries(input)) {
        if (value === undefined)
            continue;
        if (typeof value === 'string' && value.length > 1000) {
            safe[key] = `${value.slice(0, 1000)}...`;
            continue;
        }
        if (typeof value === 'object' && value !== null) {
            safe[key] = value;
            continue;
        }
        safe[key] = value;
    }
    let serialized = JSON.stringify(safe);
    if (Buffer.byteLength(serialized, 'utf8') <= MAX_METADATA_BYTES) {
        return safe;
    }
    const trimmed = { ...safe };
    trimmed.__truncated = true;
    while (Buffer.byteLength(JSON.stringify(trimmed), 'utf8') > MAX_METADATA_BYTES) {
        const keys = Object.keys(trimmed).filter((key) => key !== '__truncated');
        if (!keys.length)
            break;
        delete trimmed[keys[keys.length - 1]];
    }
    serialized = JSON.stringify(trimmed);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_METADATA_BYTES) {
        return { __truncated: true };
    }
    return trimmed;
}
async function resolveFallbackCompanyId() {
    const result = await pool.query(`
    select id
    from companies
    where is_active = true
    order by created_at asc
    limit 1
    `);
    return result.rows[0]?.id ?? null;
}
function readIpFromRequest(req) {
    if (!req)
        return undefined;
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string')
        return xff.split(',')[0]?.trim();
    if (Array.isArray(xff))
        return xff[0];
    return req.ip;
}
export class AuditService {
    repository;
    constructor(repository = new AuditRepository()) {
        this.repository = repository;
    }
    async buildContext(input) {
        const reqUserContext = input.req?.requestUserContext;
        const companyId = input.context?.companyId ??
            reqUserContext?.companyId ??
            (await resolveFallbackCompanyId());
        if (!companyId)
            return null;
        return {
            companyId,
            branchId: input.context?.branchId ?? reqUserContext?.activeBranchId ?? reqUserContext?.scope?.branchId,
            userId: input.context?.userId ?? reqUserContext?.userId,
            ipAddress: input.context?.ipAddress ?? readIpFromRequest(input.req),
            userAgent: input.context?.userAgent ?? input.req?.headers['user-agent'],
        };
    }
    async log(input) {
        const context = await this.buildContext(input);
        if (!context)
            return;
        const correlationId = input.req?.correlationId;
        return this.repository.logEvent(context, normalizeAction(input.action), input.entityType, input.entityId, sanitizeMetadata({
            ...(input.metadata ?? {}),
            ...(correlationId ? { correlationId } : {}),
        }));
    }
    logAsync(input) {
        void this.log(input).catch((error) => {
            console.error('[AUDIT] Failed to log event', error);
        });
    }
    list(companyId, filters, scope) {
        return this.repository.listAuditLogs(companyId, filters, scope);
    }
    getById(id) {
        return this.repository.getAuditLogById(id);
    }
}
