import { HttpError } from './errors.js';
export function normalizeError(error) {
    if (error instanceof HttpError) {
        return {
            statusCode: error.statusCode,
            message: error.message,
            code: 'HTTP_ERROR',
        };
    }
    const dbCode = error?.code;
    if (dbCode === '23505') {
        return {
            statusCode: 409,
            message: 'Duplicate operation detected.',
            code: 'DB_UNIQUE_VIOLATION',
            details: error?.detail,
        };
    }
    if (dbCode === '23503') {
        return {
            statusCode: 400,
            message: 'Referenced record is missing or invalid.',
            code: 'DB_FOREIGN_KEY_VIOLATION',
            details: error?.detail,
        };
    }
    if (dbCode === '40P01') {
        return {
            statusCode: 503,
            message: 'Temporary database contention detected. Please retry.',
            code: 'DB_DEADLOCK',
            details: error?.detail,
        };
    }
    if (dbCode === '40001') {
        return {
            statusCode: 503,
            message: 'Temporary serialization conflict detected. Please retry.',
            code: 'DB_SERIALIZATION_FAILURE',
            details: error?.detail,
        };
    }
    return {
        statusCode: 500,
        message: 'Internal server error',
        code: 'UNHANDLED_ERROR',
    };
}
