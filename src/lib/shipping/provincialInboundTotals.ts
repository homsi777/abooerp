import type { ProvincialInboundRow } from '../api/centersGateway';

export type ProvincialTotals = {
  shipments: number;
  parcelCount: number;
  weightKg: number;
  collectAmount: number;
  prepaidAmount: number;
  hawalaAmount: number;
  transferServiceFee: number;
  lineTotal: number;
};

export type ProvincialAgentTotals = ProvincialTotals & {
  key: string;
  agentId: string | null;
  agentName: string;
  agentCommissionAmount: number;
};

export type ProvincialCommissionSummary = {
  totalCommission: number;
  /** إجمالي المبالغ (تحصيل + مسبق + حوالات + أجور حوالات) */
  totalAmounts: number;
  /** ما يبقى للشركة بعد خصم عمولة الوكيل */
  companyCommission: number;
  missingAgentCount: number;
  missingRateCount: number;
};

function sumNumeric(values: Array<number | null | undefined>): number {
  return values.reduce((sum, value) => sum + (Number(value) || 0), 0);
}

export function rowLineTotal(row: ProvincialInboundRow): number {
  return (
    Number(row.collectAmount) +
    Number(row.prepaidAmount) +
    Number(row.hawalaAmount) +
    Number(row.transferServiceFee)
  );
}

export function computeProvincialTotals(rows: ProvincialInboundRow[]): ProvincialTotals {
  return {
    shipments: rows.length,
    parcelCount: sumNumeric(rows.map((r) => r.parcelCount)),
    weightKg: sumNumeric(rows.map((r) => r.weightKg)),
    collectAmount: sumNumeric(rows.map((r) => r.collectAmount)),
    prepaidAmount: sumNumeric(rows.map((r) => r.prepaidAmount)),
    hawalaAmount: sumNumeric(rows.map((r) => r.hawalaAmount)),
    transferServiceFee: sumNumeric(rows.map((r) => r.transferServiceFee)),
    lineTotal: sumNumeric(rows.map((r) => rowLineTotal(r))),
  };
}

function agentGroupKey(row: ProvincialInboundRow): string {
  if (row.agentId) return `id:${row.agentId}`;
  const name = String(row.agentName ?? '').trim();
  if (name) return `name:${name.toLowerCase()}`;
  const dest = String(row.ledgerDestination ?? row.operationalCenter ?? '').trim();
  if (dest) return `dest:${dest.toLowerCase()}`;
  return 'none';
}

function agentDisplayName(row: ProvincialInboundRow): string {
  const name = String(row.agentName ?? '').trim();
  if (name) return name;
  const dest = String(row.ledgerDestination ?? row.operationalCenter ?? '').trim();
  return dest || 'بدون وكيل';
}

export function groupProvincialByAgent(rows: ProvincialInboundRow[]): ProvincialAgentTotals[] {
  const groups = new Map<string, ProvincialInboundRow[]>();
  for (const row of rows) {
    const key = agentGroupKey(row);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  return [...groups.entries()]
    .map(([key, groupRows]) => {
      const sample = groupRows[0];
      return {
        key,
        agentId: sample.agentId,
        agentName: agentDisplayName(sample),
        agentCommissionAmount: sumNumeric(groupRows.map((r) => r.agentCommissionAmount)),
        ...computeProvincialTotals(groupRows),
      };
    })
    .sort((a, b) => b.shipments - a.shipments || a.agentName.localeCompare(b.agentName, 'ar'));
}

export function computeProvincialCommissionSummary(rows: ProvincialInboundRow[]): ProvincialCommissionSummary {
  let totalCommission = 0;
  let missingAgentCount = 0;
  let missingRateCount = 0;
  for (const row of rows) {
    totalCommission += Number(row.agentCommissionAmount ?? 0);
    if (row.commissionIssue === 'missing_agent') missingAgentCount += 1;
    else if (row.commissionIssue === 'missing_rate') missingRateCount += 1;
  }
  const totals = computeProvincialTotals(rows);
  const roundedCommission = Math.round(totalCommission * 100) / 100;
  const companyCommission = Math.round((totals.lineTotal - roundedCommission) * 100) / 100;
  return {
    totalCommission: roundedCommission,
    totalAmounts: totals.lineTotal,
    companyCommission,
    missingAgentCount,
    missingRateCount,
  };
}

export function formatWeightTotal(value: number): string {
  if (!value) return '0';
  return value % 1 === 0 ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
