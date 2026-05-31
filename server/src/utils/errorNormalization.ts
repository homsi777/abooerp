import { HttpError } from './errors.js';

export interface NormalizedError {
  statusCode: number;
  message: string;
  code: string;
  details?: unknown;
}

export function normalizeError(error: unknown): NormalizedError {
  if (error instanceof HttpError) {
    return {
      statusCode: error.statusCode,
      message: error.message,
      code: 'HTTP_ERROR',
    };
  }

  const dbCode = (error as any)?.code as string | undefined;
  if (dbCode === '23505') {
    const detail = String((error as any)?.detail || '');
    const constraint = String((error as any)?.constraint || '');
    const duplicateValue = (() => {
      const match = detail.match(/\)=\(([^)]+)\)/);
      return match?.[1] ?? '';
    })();
    const message =
      detail.includes('(shipment_no)') || constraint.includes('shipment') || constraint.includes('shipment_no')
        ? `رقم الإيصال مكرر${duplicateValue ? `: ${duplicateValue}` : ''}`
        : 'تم إدخال بيانات مكررة. يرجى التحقق والمحاولة مجدداً.';
    return {
      statusCode: 409,
      message,
      code: 'DB_UNIQUE_VIOLATION',
      details: detail,
    };
  }
  if (dbCode === '23503') {
    return {
      statusCode: 400,
      message: 'Referenced record is missing or invalid.',
      code: 'DB_FOREIGN_KEY_VIOLATION',
      details: (error as any)?.detail,
    };
  }
  if (dbCode === '40P01') {
    return {
      statusCode: 503,
      message: 'Temporary database contention detected. Please retry.',
      code: 'DB_DEADLOCK',
      details: (error as any)?.detail,
    };
  }
  if (dbCode === '40001') {
    return {
      statusCode: 503,
      message: 'Temporary serialization conflict detected. Please retry.',
      code: 'DB_SERIALIZATION_FAILURE',
      details: (error as any)?.detail,
    };
  }
  if (dbCode === '42703' || dbCode === '42P01' || dbCode === '23514') {
    return {
      statusCode: 503,
      message: 'مخطط قاعدة البيانات غير محدث. شغّل ترحيلات قاعدة البيانات ثم أعد تشغيل الخادم.',
      code: 'DB_SCHEMA_OUTDATED',
      details: (error as any)?.detail || (error as any)?.message,
    };
  }

  return {
    statusCode: 500,
    message: 'Internal server error',
    code: 'UNHANDLED_ERROR',
  };
}
