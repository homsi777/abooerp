import type { PoolClient } from 'pg';

function labelNormSql(expr: string): string {
  return `lower(regexp_replace(trim(${expr}), E'\\\\s+', ' ', 'g'))`;
}

export type SessionDriverMatchOptions = {
  rowAlias?: string;
  dateParam?: string;
};

/**
 * Matches how ShipmentQuickLedger filters rows by driver (remoteRowMatchesDriver):
 * driver_id, fuzzy driver_label vs drivers.full_name, vehicle assignment, or transfer target.
 */
export function buildSessionDriverMatchCondition(
  sessionAlias: string,
  driverIdParam: string,
  options?: SessionDriverMatchOptions,
): string {
  const parts = [
    `${sessionAlias}.driver_id = ${driverIdParam}::uuid`,
    `(
      nullif(trim(${sessionAlias}.driver_label), '') is not null
      and exists (
        select 1
        from drivers dr
        where dr.id = ${driverIdParam}::uuid
          and (
            ${labelNormSql(`${sessionAlias}.driver_label`)} = ${labelNormSql("coalesce(dr.full_name, '')")}
            or ${labelNormSql(`${sessionAlias}.driver_label`)} like '%' || ${labelNormSql("coalesce(dr.full_name, '')")} || '%'
            or ${labelNormSql("coalesce(dr.full_name, '')")} like '%' || ${labelNormSql(`${sessionAlias}.driver_label`)} || '%'
          )
      )
    )`,
    `exists (
      select 1
      from vehicles v
      where v.id = ${sessionAlias}.vehicle_id
        and v.driver_id = ${driverIdParam}::uuid
    )`,
  ];

  if (options?.rowAlias && options?.dateParam) {
    parts.push(`exists (
      select 1
      from daily_ledger_row_transfer_items ti
      join daily_ledger_row_transfers t on t.id = ti.transfer_id
      where ti.row_id = ${options.rowAlias}.id
        and t.new_driver_id = ${driverIdParam}::uuid
        and t.new_ledger_date = ${options.dateParam}::date
    )`);
  }

  return `(${parts.join(' or ')})`;
}

/** Resolve driver UUID from a free-text label when the client did not send driverId. */
export async function resolveDriverIdByLabel(
  client: PoolClient,
  driverLabel: string | null | undefined,
): Promise<string | null> {
  const label = String(driverLabel ?? '').trim().replace(/\s+/g, ' ');
  if (!label) return null;

  const result = await client.query<{ id: string }>(
    `
    select d.id
    from drivers d
    where (
      lower(regexp_replace(trim(coalesce(d.full_name, '')), E'\\\\s+', ' ', 'g'))
        = lower($1)
      or lower(trim(coalesce(d.full_name, ''))) like '%' || lower($1) || '%'
      or lower($1) like '%' || lower(trim(coalesce(d.full_name, ''))) || '%'
    )
    order by
      case
        when lower(regexp_replace(trim(coalesce(d.full_name, '')), E'\\\\s+', ' ', 'g')) = lower($1)
        then 0
        else 1
      end,
      length(coalesce(d.full_name, '')) desc
    limit 1
    `,
    [label],
  );

  return result.rows[0]?.id ?? null;
}
