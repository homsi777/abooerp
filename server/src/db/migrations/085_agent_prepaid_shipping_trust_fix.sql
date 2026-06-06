-- Prepaid shipping was already collected at origin — remove erroneous agent trust on shipping fee.
delete from party_financial_movements pfm
using shipments s
where pfm.shipment_id = s.id
  and pfm.party_type = 'agent'
  and pfm.party_id = s.agent_id
  and pfm.movement_type = 'shipment_shipping_fee'
  and pfm.is_reversal = false
  and coalesce(s.prepaid_amount, 0) > 0
  and coalesce(s.freight_charge, 0) > 0
  and coalesce(s.prepaid_amount, 0) >= coalesce(s.freight_charge, 0);
