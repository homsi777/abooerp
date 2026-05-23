import type { Request } from 'express';

export interface DataScope {
  companyId?: string;
  branchId?: string;
  agentId?: string;
  /** Logged-in user (for created_by scoping on shipments, parties, etc.) */
  userId?: string;
  agentGovernorate?: string;
  agentCity?: string;
  agentArea?: string;
  /**
   * When true, finance list queries require agent_id to match (vouchers without agent_id are hidden).
   */
  financeAgentScope?: boolean;
}

function normalizeHeaderValue(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value[0];
  return value;
}

export function parseDataScope(req: Request): DataScope {
  const userContext = (req as any).requestUserContext as any;
  const companyIdFromContext: string | undefined = userContext?.companyId;
  const roleCode = String(userContext?.roleCode ?? '').toLowerCase();
  const userType = String(userContext?.userType ?? '').toLowerCase();

  if (roleCode === 'admin' || userType === 'admin') {
    return { companyId: companyIdFromContext, userId: userContext?.userId as string | undefined };
  }

  /**
   * أدوار تشغيلية/مالية على مستوى الشركة: لا نفرض فرعاً واحداً على الاستعلامات.
   * يمنع اختفاء الشحنات عندما يختار المستخدم فرعاً في تسجيل الدخول بينما البيانات على فرع آخر،
   * ويمنع فشل حفظ الشحنة لأن دفتر الإدخال يختار فرعاً مختلفاً عن «الفرع النشط» في الجلسة.
   */
  const companyWideRoles = new Set([
    'general_manager',
    'data_entry',
    'operator',
    'manager',
    'accountant',
    'branch_manager',
    'field_accountant',
  ]);
  if (companyWideRoles.has(roleCode)) {
    return { companyId: companyIdFromContext, userId: userContext?.userId as string | undefined };
  }

  const branchFromContext: string | undefined =
    userContext?.activeBranchId ?? userContext?.scope?.branchId ?? userContext?.allowedBranchIds?.[0];

  // Agent users: never trust client-supplied agent id — always bind to the linked agent profile.
  if (userType === 'agent') {
    const agentId = userContext?.scope?.agentId as string | undefined;
    const userId = userContext?.userId as string | undefined;
    if (!agentId) {
      return {
        companyId: companyIdFromContext,
        userId,
        financeAgentScope: true,
      };
    }
    return {
      companyId: companyIdFromContext,
      branchId: branchFromContext,
      agentId,
      userId,
      agentGovernorate: userContext?.scope?.agentGovernorate,
      agentCity: userContext?.scope?.agentCity,
      agentArea: userContext?.scope?.agentArea,
      financeAgentScope: true,
    };
  }

  const requestInjectedScope = (req as any).requestScope as DataScope | undefined;
  if (requestInjectedScope?.branchId || requestInjectedScope?.agentId) {
    return {
      companyId: companyIdFromContext,
      userId: userContext?.userId,
      ...requestInjectedScope,
    };
  }

  const branchIdFromHeader = normalizeHeaderValue(req.headers['x-branch-id'] as string | string[] | undefined);
  const agentIdFromHeader = normalizeHeaderValue(req.headers['x-agent-id'] as string | string[] | undefined);

  const branchIdFromQuery = typeof req.query.branchId === 'string' ? req.query.branchId : undefined;
  const agentIdFromQuery = typeof req.query.agentId === 'string' ? req.query.agentId : undefined;

  return {
    companyId: companyIdFromContext,
    branchId: branchIdFromHeader ?? branchIdFromQuery ?? branchFromContext,
    agentId: agentIdFromHeader ?? agentIdFromQuery,
    userId: userContext?.userId,
  };
}
