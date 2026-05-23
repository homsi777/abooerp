import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
export function signAccessToken(payload) {
    const options = {
        expiresIn: env.AUTH_ACCESS_TOKEN_TTL,
    };
    return jwt.sign(payload, env.AUTH_JWT_SECRET, {
        ...options,
    });
}
export function verifyAccessToken(token) {
    return jwt.verify(token, env.AUTH_JWT_SECRET);
}
export function generateRefreshToken() {
    return crypto.randomBytes(48).toString('hex');
}
export function hashRefreshToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}
