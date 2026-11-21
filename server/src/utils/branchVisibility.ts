import type { Request } from 'express';
import { pool } from '../db/pool.js';
import { agentDestinationHints } from './agentDocumentationScope.js';
import { canAccessAnyCompanyBranch } from './dailyLedgerAccess.js';
import { parseDataScope } from './scope.js';

/**
 * من يرى أي سطر شحن؟
 *
 * القاعدة: الفرع يرى السطر إذا كان هو **المصدر** (جلسة الدفتر تابعة له)،
 * أو كانت **الوجهة هي مدينته** (حقل city في جدول branches). لا شيء غير ذلك.
 *
 * المطابقة تامة بعد تطبيع بسيط (مسافات، حروف صغيرة، أ/إ/آ→ا، ى→ي، ة→ه) —
 * وليست "يحتوي على"، حتى لا تظهر طرود "ريف دمشق" عند "دمشق".
 * الوكيل (agent) تُحدَّد رؤيته بمنطقته/مدينته/محافظته.
 * مدير الشركة العام (admin وأدوار المدير) يبقى بلا قيد.
 */

export type BranchVisibility =
  | { companyWide: true }
  | { companyWide: false; branchIds: string[]; cityKeys: string[]; agentHints: string[] };

/** نفس التطبيع الذي يجريه SQL في destinationKeySql — يجب أن يبقيا متطابقين. */
export function destinationMatchKey(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

export function destinationKeySql(column: string): string {
  return `translate(lower(btrim(regexp_replace(coalesce(${column}, ''), '\\s+', ' ', 'g'))), 'أإآىة', 'ااايه')`;
}

export async function resolveBranchVisibility(req: Request): Promise<BranchVisibility> {
  const ctx = (req as any).requestUserContext ?? {};
  const roleCode = String(ctx.roleCode ?? '').toLowerCase();
  const userType = String(ctx.userType ?? '').toLowerCase();
  if (canAccessAnyCompanyBranch(roleCode, userType)) return { companyWide: true };

  const scope = parseDataScope(req);
  const agentHints =
    userType === 'agent' || roleCode === 'agent_user'
      ? agentDestinationHints(scope).map(destinationMatchKey)
      : [];

  const branchIds: string[] = agentHints.length
    ? []
    : Array.isArray(ctx.allowedBranchIds) && ctx.allowedBranchIds.length
      ? ctx.allowedBranchIds
      : [ctx.activeBranchId, ctx.scope?.branchId].filter((v): v is string => typeof v === 'string');

  let cityKeys: string[] = [];
  if (branchIds.length) {
    const result = await pool.query<{ city: string | null }>(
      `select city from branches where id = any($1::uuid[])`,
      [branchIds],
    );
    cityKeys = [...new Set(result.rows.map((r) => destinationMatchKey(r.city)).filter(Boolean))];
  }
  return { companyWide: false, branchIds, cityKeys, agentHints };
}

/**
 * شرط SQL: السطر مرئي (مصدر أو وجهة). يُرجع '' لمدير الشركة العام.
 * `s` جلسة الدفتر و`r` السطر. يضيف معاملاته إلى values.
 */
export function visibleRowCondition(vis: BranchVisibility, values: unknown[]): string {
  if (vis.companyWide) return '';
  const parts: string[] = [];
  if (vis.branchIds.length) {
    values.push(vis.branchIds);
    parts.push(`s.branch_id = any($${values.length}::uuid[])`);
  }
  if (vis.cityKeys.length) {
    values.push(vis.cityKeys);
    parts.push(`${destinationKeySql('r.destination')} = any($${values.length}::text[])`);
  }
  if (vis.agentHints.length) {
    values.push(vis.agentHints);
    parts.push(`exists (
      select 1 from unnest($${values.length}::text[]) h(v)
      where ${destinationKeySql('r.destination')} = h.v
         or position(h.v in ${destinationKeySql('r.destination')}) > 0
    )`);
  }
  return parts.length ? `(${parts.join(' or ')})` : '1 = 0';
}

/** شرط SQL: السطر **وارد** إلى هذا المستخدم (وجهته مدينته، ومصدره فرع آخر). */
export function incomingRowCondition(vis: BranchVisibility, values: unknown[]): string {
  if (vis.companyWide || !vis.cityKeys.length) return '1 = 0';
  values.push(vis.cityKeys);
  let cond = `${destinationKeySql('r.destination')} = any($${values.length}::text[])`;
  if (vis.branchIds.length) {
    values.push(vis.branchIds);
    cond += ` and not (s.branch_id = any($${values.length}::uuid[]))`;
  }
  return `(${cond})`;
}
