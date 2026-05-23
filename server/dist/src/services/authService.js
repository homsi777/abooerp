import bcrypt from 'bcryptjs';
import { pool } from '../db/pool.js';
import { HttpError } from '../utils/errors.js';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../auth/tokens.js';
import { loadUserContextByUserId, toAuthUserDto } from '../auth/userContext.js';
import { env } from '../config/env.js';
import { AuditService } from './auditService.js';
function computeRefreshExpiry() {
    const expires = new Date();
    expires.setDate(expires.getDate() + env.AUTH_REFRESH_TOKEN_TTL_DAYS);
    return expires;
}
export class AuthService {
    auditService = new AuditService();
    async login(params) {
        const userResult = await pool.query(`
      select id, username, password_hash, status, is_active, company_id
      from users
      where username = $1
      limit 1
      `, [params.username]);
        if (!userResult.rowCount) {
            this.auditService.logAsync({
                action: 'LOGIN_FAILED',
                entityType: 'auth',
                metadata: {
                    username: params.username,
                    reason: 'user_not_found',
                    branchId: params.branchId,
                    userAgent: params.userAgent,
                    ipAddress: params.ipAddress,
                },
                context: {
                    ipAddress: params.ipAddress,
                    userAgent: params.userAgent,
                },
            });
            throw new HttpError(401, 'Invalid username or password.');
        }
        const user = userResult.rows[0];
        if (!user.is_active) {
            this.auditService.logAsync({
                action: 'LOGIN_FAILED',
                entityType: 'auth',
                entityId: user.id,
                metadata: {
                    username: params.username,
                    reason: 'user_inactive',
                    branchId: params.branchId,
                },
                context: {
                    companyId: user.company_id ?? undefined,
                    userId: user.id,
                    ipAddress: params.ipAddress,
                    userAgent: params.userAgent,
                },
            });
            throw new HttpError(403, 'User is inactive.');
        }
        if (user.status !== 'active') {
            this.auditService.logAsync({
                action: 'LOGIN_FAILED',
                entityType: 'auth',
                entityId: user.id,
                metadata: {
                    username: params.username,
                    reason: `status_${user.status}`,
                    branchId: params.branchId,
                },
                context: {
                    companyId: user.company_id ?? undefined,
                    userId: user.id,
                    ipAddress: params.ipAddress,
                    userAgent: params.userAgent,
                },
            });
            throw new HttpError(403, `User is not active (${user.status}).`);
        }
        const matched = await bcrypt.compare(params.password, user.password_hash);
        if (!matched) {
            this.auditService.logAsync({
                action: 'LOGIN_FAILED',
                entityType: 'auth',
                entityId: user.id,
                metadata: {
                    username: params.username,
                    reason: 'password_mismatch',
                    branchId: params.branchId,
                },
                context: {
                    companyId: user.company_id ?? undefined,
                    userId: user.id,
                    ipAddress: params.ipAddress,
                    userAgent: params.userAgent,
                },
            });
            throw new HttpError(401, 'Invalid username or password.');
        }
        const context = await loadUserContextByUserId(user.id);
        if (!context) {
            throw new HttpError(401, 'User context not found.');
        }
        const activeBranchId = params.branchId ?? context.scope.branchId;
        if (!activeBranchId) {
            this.auditService.logAsync({
                action: 'LOGIN_FAILED',
                entityType: 'auth',
                entityId: user.id,
                metadata: {
                    username: params.username,
                    reason: 'missing_branch_scope',
                    branchId: params.branchId,
                },
                context: {
                    companyId: context.companyId,
                    userId: user.id,
                    ipAddress: params.ipAddress,
                    userAgent: params.userAgent,
                },
            });
            throw new HttpError(403, 'No branch scope available for this user.');
        }
        if (!context.allowedBranchIds.includes(activeBranchId)) {
            this.auditService.logAsync({
                action: 'LOGIN_FAILED',
                entityType: 'auth',
                entityId: user.id,
                metadata: {
                    username: params.username,
                    reason: 'branch_not_allowed',
                    branchId: params.branchId,
                },
                context: {
                    companyId: context.companyId,
                    userId: user.id,
                    ipAddress: params.ipAddress,
                    userAgent: params.userAgent,
                },
            });
            throw new HttpError(403, 'Selected branch is not allowed for this user.');
        }
        const refreshToken = generateRefreshToken();
        const refreshTokenHash = hashRefreshToken(refreshToken);
        const expiresAt = computeRefreshExpiry();
        const sessionInsert = await pool.query(`
      insert into auth_sessions(user_id, refresh_token_hash, user_agent, ip_address, expires_at)
      values ($1, $2, $3, $4, $5)
      returning id
      `, [user.id, refreshTokenHash, params.userAgent ?? null, params.ipAddress ?? null, expiresAt.toISOString()]);
        const sessionId = sessionInsert.rows[0].id;
        const accessToken = signAccessToken({
            sub: context.userId,
            sid: sessionId,
            role: context.roleCode,
            branchId: activeBranchId,
            agentId: context.scope.agentId,
        });
        const scopedContext = {
            ...context,
            activeBranchId,
            scope: {
                ...context.scope,
                branchId: activeBranchId,
            },
        };
        this.auditService.logAsync({
            action: 'LOGIN_SUCCESS',
            entityType: 'auth',
            entityId: user.id,
            metadata: {
                username: params.username,
                branchId: activeBranchId,
                sessionId,
            },
            context: {
                companyId: context.companyId,
                branchId: activeBranchId,
                userId: user.id,
                ipAddress: params.ipAddress,
                userAgent: params.userAgent,
            },
        });
        return {
            user: toAuthUserDto(scopedContext),
            session: {
                accessToken,
                refreshToken,
                tokenType: 'Bearer',
                expiresIn: env.AUTH_ACCESS_TOKEN_TTL,
            },
        };
    }
    async me(userId) {
        const context = await loadUserContextByUserId(userId);
        if (!context || context.status !== 'active') {
            throw new HttpError(401, 'Authentication required.');
        }
        return toAuthUserDto({
            ...context,
            activeBranchId: context.scope.branchId,
        });
    }
    async refresh(params) {
        const tokenHash = hashRefreshToken(params.refreshToken);
        const sessionResult = await pool.query(`
      select id, user_id, expires_at, revoked_at
      from auth_sessions
      where refresh_token_hash = $1
      limit 1
      `, [tokenHash]);
        if (!sessionResult.rowCount) {
            this.auditService.logAsync({
                action: 'SESSION_EXPIRED',
                entityType: 'auth',
                metadata: {
                    reason: 'refresh_token_not_found',
                },
                context: {
                    ipAddress: params.ipAddress,
                    userAgent: params.userAgent,
                },
            });
            throw new HttpError(401, 'Invalid refresh token.');
        }
        const session = sessionResult.rows[0];
        if (session.revoked_at) {
            this.auditService.logAsync({
                action: 'SESSION_EXPIRED',
                entityType: 'auth',
                entityId: session.user_id,
                metadata: {
                    reason: 'session_revoked',
                    sessionId: session.id,
                },
                context: {
                    userId: session.user_id,
                    ipAddress: params.ipAddress,
                    userAgent: params.userAgent,
                },
            });
            throw new HttpError(401, 'Session already revoked.');
        }
        if (new Date(session.expires_at).getTime() <= Date.now()) {
            this.auditService.logAsync({
                action: 'SESSION_EXPIRED',
                entityType: 'auth',
                entityId: session.user_id,
                metadata: {
                    reason: 'refresh_token_expired',
                    sessionId: session.id,
                },
                context: {
                    userId: session.user_id,
                    ipAddress: params.ipAddress,
                    userAgent: params.userAgent,
                },
            });
            throw new HttpError(401, 'Refresh token expired.');
        }
        const context = await loadUserContextByUserId(session.user_id);
        if (!context || context.status !== 'active') {
            throw new HttpError(401, 'Authentication required.');
        }
        const activeBranchId = params.branchId ?? context.scope.branchId;
        if (!activeBranchId) {
            this.auditService.logAsync({
                action: 'TOKEN_REFRESH',
                entityType: 'auth',
                entityId: session.user_id,
                metadata: {
                    result: 'failed',
                    reason: 'missing_branch_scope',
                },
                context: {
                    companyId: context?.companyId,
                    userId: session.user_id,
                    ipAddress: params.ipAddress,
                    userAgent: params.userAgent,
                },
            });
            throw new HttpError(403, 'No branch scope available for this user.');
        }
        if (!context.allowedBranchIds.includes(activeBranchId)) {
            this.auditService.logAsync({
                action: 'TOKEN_REFRESH',
                entityType: 'auth',
                entityId: session.user_id,
                metadata: {
                    result: 'failed',
                    reason: 'branch_not_allowed',
                    branchId: params.branchId,
                },
                context: {
                    companyId: context.companyId,
                    userId: session.user_id,
                    ipAddress: params.ipAddress,
                    userAgent: params.userAgent,
                },
            });
            throw new HttpError(403, 'Selected branch is not allowed for this user.');
        }
        const nextRefreshToken = generateRefreshToken();
        await pool.query(`
      update auth_sessions
      set refresh_token_hash = $2,
          user_agent = $3,
          ip_address = $4,
          expires_at = $5,
          updated_at = now()
      where id = $1
      `, [session.id, hashRefreshToken(nextRefreshToken), params.userAgent ?? null, params.ipAddress ?? null, computeRefreshExpiry().toISOString()]);
        const accessToken = signAccessToken({
            sub: context.userId,
            sid: session.id,
            role: context.roleCode,
            branchId: activeBranchId,
            agentId: context.scope.agentId,
        });
        const scopedContext = {
            ...context,
            activeBranchId,
            scope: {
                ...context.scope,
                branchId: activeBranchId,
            },
        };
        this.auditService.logAsync({
            action: 'TOKEN_REFRESH',
            entityType: 'auth',
            entityId: session.user_id,
            metadata: {
                result: 'success',
                sessionId: session.id,
                branchId: activeBranchId,
            },
            context: {
                companyId: context.companyId,
                branchId: activeBranchId,
                userId: session.user_id,
                ipAddress: params.ipAddress,
                userAgent: params.userAgent,
            },
        });
        return {
            user: toAuthUserDto(scopedContext),
            session: {
                accessToken,
                refreshToken: nextRefreshToken,
                tokenType: 'Bearer',
                expiresIn: env.AUTH_ACCESS_TOKEN_TTL,
            },
        };
    }
    async logoutBySession(sessionId) {
        const session = await pool.query(`
      select user_id
      from auth_sessions
      where id = $1
      limit 1
      `, [sessionId]);
        await pool.query(`
      update auth_sessions
      set revoked_at = now(), updated_at = now()
      where id = $1 and revoked_at is null
      `, [sessionId]);
        const userId = session.rows[0]?.user_id;
        if (userId) {
            const context = await loadUserContextByUserId(userId);
            this.auditService.logAsync({
                action: 'LOGOUT',
                entityType: 'auth',
                entityId: userId,
                metadata: {
                    sessionId,
                },
                context: {
                    companyId: context?.companyId,
                    branchId: context?.scope.branchId,
                    userId,
                },
            });
        }
    }
    async logoutByRefreshToken(refreshToken) {
        const lookup = await pool.query(`
      select id, user_id
      from auth_sessions
      where refresh_token_hash = $1
      limit 1
      `, [hashRefreshToken(refreshToken)]);
        await pool.query(`
      update auth_sessions
      set revoked_at = now(), updated_at = now()
      where refresh_token_hash = $1 and revoked_at is null
      `, [hashRefreshToken(refreshToken)]);
        const session = lookup.rows[0];
        if (session?.user_id) {
            const context = await loadUserContextByUserId(session.user_id);
            this.auditService.logAsync({
                action: 'LOGOUT',
                entityType: 'auth',
                entityId: session.user_id,
                metadata: {
                    sessionId: session.id,
                    via: 'refresh_token',
                },
                context: {
                    companyId: context?.companyId,
                    branchId: context?.scope.branchId,
                    userId: session.user_id,
                },
            });
        }
    }
}
