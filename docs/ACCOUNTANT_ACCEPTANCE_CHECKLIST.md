# ACCOUNTANT ACCEPTANCE CHECKLIST

Use this checklist during real company acceptance testing. Mark Passed? with ✅/❌ and add notes.

| Scenario | Steps | Expected Result | Passed? | Notes |
|----------|-------|-----------------|---------|-------|
| 1) Shipment with collection freight | Create a shipment with freight charge and collection (تحصيل/COD) | Freight is recorded; COD is recorded separately; accounting movements match expected |  |  |
| 2) Shipment with prepaid freight | Create a shipment with prepaid amount | Prepaid is recorded; freight not mixed with COD; statements reflect correct balances |  |  |
| 3) Shipment with transfer service fee from Daily Shipping Book | In Daily Shipping Book enter row with أجرة الحوالة > 0 then post to shipment | Shipment is created; linked transfer is created as PENDING; أجرة الحوالة does not affect agent commission |  |  |
| 4) Standalone transfer | Create a transfer from Transfers module | Transfer saved as PENDING; shows correct sender/receiver and service fee |  |  |
| 5) Complete transfer and verify receipt voucher/cashbox | Complete a PENDING transfer and select cashbox | Transfer becomes COMPLETED; receipt voucher is created; cashbox balance changes correctly |  |  |
| 6) Cancel completed transfer and verify reversal | Cancel a COMPLETED transfer with reason | Transfer becomes CANCELLED; receipt voucher is cancelled; reversal entries exist; cashbox impact is reversed |  |  |
| 7) Change agent commission after old shipment | Change agent commission percentage, then review old shipments | Old shipments keep commission snapshot unchanged |  |  |
| 8) Agent COD statement check | Open Agent COD statement with filters | COD, freight, prepaid, agent commission, and transfer service fee are clearly separated |  |  |
| 9) Transfer profit report check | Open “Transfer Profit Report” | Completed transfers contribute to realized profit; pending/cancelled do not inflate profit |  |  |
| 10) Pending transfers report check | Open “Pending Transfers Report” | Shows PENDING transfers only; helps accountant track unposted fees |  |  |
| 11) Legacy additional charges review check | Open “Legacy Additional Charges Review” | Shows shipments where additional_charges>0 and transfer_service_fee=0 for manual review only |  |  |
| 12) Permissions test | Login with limited user (data entry / agent / accountant) | Forbidden actions are blocked; allowed actions work; branch scope enforcement holds |  |  |
| 13) Double-click transfer completion test | Trigger completion twice quickly | No duplicate voucher or cashbox postings; completion is idempotent |  |  |

