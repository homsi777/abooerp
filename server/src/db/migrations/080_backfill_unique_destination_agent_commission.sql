-- Repair shipment agent linkage created before destination-agent auto resolution.
-- A shipment is updated only when its destination has exactly one active agent
-- inside the same company. Existing explicit agent links and snapshots are kept.

with unique_destination_agents as (
  select
    s.id as shipment_id,
    min(a.id::text)::uuid as agent_id
  from shipments s
  join branches b
    on b.company_id = s.company_id
  join agents a
    on a.branch_id = b.id
   and a.is_active = true
   and (
     lower(trim(coalesce(a.area, ''))) = lower(trim(coalesce(s.destination_city, '')))
     or lower(trim(coalesce(a.city, ''))) = lower(trim(coalesce(s.destination_city, '')))
     or lower(trim(coalesce(a.governorate, ''))) = lower(trim(coalesce(s.destination_city, '')))
   )
  where s.agent_id is null
    and s.deleted_at is null
    and trim(coalesce(s.destination_city, '')) <> ''
  group by s.id
  having count(distinct a.id) = 1
)
update shipments s
set
  agent_id = u.agent_id,
  agent_commission_base_type = coalesce(s.agent_commission_base_type, 'FREIGHT_CHARGE'),
  agent_commission_base_amount = coalesce(s.agent_commission_base_amount, s.freight_charge, 0),
  agent_commission_percentage_snapshot = coalesce(s.agent_commission_percentage_snapshot, a.commission_percentage, 0),
  agent_commission_amount_snapshot = coalesce(
    s.agent_commission_amount_snapshot,
    round((coalesce(s.freight_charge, 0) * coalesce(a.commission_percentage, 0)) / 100, 2)
  ),
  updated_at = now()
from unique_destination_agents u
join agents a on a.id = u.agent_id
where s.id = u.shipment_id
  and s.agent_id is null;

update shipments s
set
  agent_commission_base_type = coalesce(s.agent_commission_base_type, 'FREIGHT_CHARGE'),
  agent_commission_base_amount = coalesce(s.agent_commission_base_amount, s.freight_charge, 0),
  agent_commission_percentage_snapshot = coalesce(s.agent_commission_percentage_snapshot, a.commission_percentage, 0),
  agent_commission_amount_snapshot = coalesce(
    s.agent_commission_amount_snapshot,
    round((coalesce(s.freight_charge, 0) * coalesce(a.commission_percentage, 0)) / 100, 2)
  ),
  updated_at = now()
from agents a
where s.agent_id = a.id
  and s.deleted_at is null
  and (
    s.agent_commission_base_type is null
    or s.agent_commission_base_amount is null
    or s.agent_commission_percentage_snapshot is null
    or s.agent_commission_amount_snapshot is null
  );
