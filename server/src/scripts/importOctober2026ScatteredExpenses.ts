/**
 * One-time historical import: scattered cash expenses (مصاريف متفرقة) for
 * October 2026, transcribed from the company's old accounting program, so
 * that صندوق رئيسي / صندوق محاسب match it exactly.
 *
 * Each row becomes a real, confirmed payment voucher (relatedEntityType
 * 'expense') dated to its true historical day — reusing the exact same
 * repository method the "مصاريف" screen itself calls, so cashbox balances
 * update through the normal, audited path. Safe to re-run: skips any
 * voucher_no that already exists.
 *
 * Usage:
 *   npx tsx server/src/scripts/importOctober2026ScatteredExpenses.ts
 */

import dotenv from 'dotenv';
import { pool } from '../db/pool.js';
import { FinanceRepository } from '../repositories/financeRepository.js';

dotenv.config();

const MAIN_CASHBOX_NAME = 'صندوق رئيسي';
const ACCOUNTANT_CASHBOX_NAME = 'صندوق محاسب';

type Row = { date: string; cashbox: 'MAIN' | 'ACCOUNTANT'; amount: number; note: string; oldRef: string };

// تاريخ dd-mm-yyyy -> ISO، كما وردت في سجل البرنامج القديم.
function iso(d: string): string {
  const [day, month, year] = d.split('-');
  return `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`;
}

const ROWS: Row[] = [
  { date: iso('1-10-2026'), cashbox: 'ACCOUNTANT', amount: 5.00, note: 'فرد سيليكون مهند الشوفير', oldRef: '885/396' },
  { date: iso('1-10-2026'), cashbox: 'ACCOUNTANT', amount: 4.00, note: 'مصروف مركز', oldRef: '885/396' },
  { date: iso('1-10-2026'), cashbox: 'ACCOUNTANT', amount: 4.00, note: 'سكر + شاي + بن للحراس', oldRef: '885/396' },
  { date: iso('1-10-2026'), cashbox: 'ACCOUNTANT', amount: 6.00, note: 'شادر + حراسة', oldRef: '885/396' },
  { date: iso('1-10-2026'), cashbox: 'ACCOUNTANT', amount: 3.00, note: 'لودالين + بن', oldRef: '885/396' },
  { date: iso('1-10-2026'), cashbox: 'MAIN', amount: 108.00, note: 'تصليح ستافة صندوق رئيسي', oldRef: '887/397' },
  { date: iso('3-10-2026'), cashbox: 'ACCOUNTANT', amount: 8.00, note: 'سكر + بن + وحدات', oldRef: '888/398' },
  { date: iso('3-10-2026'), cashbox: 'ACCOUNTANT', amount: 2.00, note: 'عصير للضيوف', oldRef: '888/398' },
  { date: iso('3-10-2026'), cashbox: 'ACCOUNTANT', amount: 6.00, note: 'شادر + حراسة', oldRef: '888/398' },
  { date: iso('3-10-2026'), cashbox: 'MAIN', amount: 4.00, note: 'تصليح الكيا سيارة المركز', oldRef: '888/398' },
  { date: iso('4-10-2026'), cashbox: 'ACCOUNTANT', amount: 6.00, note: 'شادر + حراسة', oldRef: '894/399' },
  { date: iso('4-10-2026'), cashbox: 'ACCOUNTANT', amount: 12.00, note: 'سكر + شاي + بن + لزاق + شنيار', oldRef: '894/399' },
  { date: iso('4-10-2026'), cashbox: 'ACCOUNTANT', amount: 10.00, note: 'غداء للعمال + كولا', oldRef: '894/399' },
  { date: iso('4-10-2026'), cashbox: 'ACCOUNTANT', amount: 40.00, note: 'متفرقات عزوز', oldRef: '894/399' },
  { date: iso('5-10-2026'), cashbox: 'MAIN', amount: 38.00, note: 'مازوت سيارة المركز بيد مهند', oldRef: '904/404' },
  { date: iso('5-10-2026'), cashbox: 'ACCOUNTANT', amount: 13.00, note: 'جرة غاز', oldRef: '904/404' },
  { date: iso('5-10-2026'), cashbox: 'ACCOUNTANT', amount: 3.00, note: 'لودالين + بن', oldRef: '904/404' },
  { date: iso('6-10-2026'), cashbox: 'ACCOUNTANT', amount: 6.00, note: 'شادر + حراسة', oldRef: '909/406' },
  { date: iso('6-10-2026'), cashbox: 'ACCOUNTANT', amount: 7.00, note: 'مصروف سيارة الكيا + طلبات', oldRef: '909/406' },
  { date: iso('7-10-2026'), cashbox: 'ACCOUNTANT', amount: 3.00, note: 'امجد عبو', oldRef: '914/407' },
  { date: iso('7-10-2026'), cashbox: 'ACCOUNTANT', amount: 7.00, note: 'سكر + شاي + بن + ماء + كولا', oldRef: '914/407' },
  { date: iso('7-10-2026'), cashbox: 'ACCOUNTANT', amount: 6.00, note: 'شادر + حراسة', oldRef: '914/407' },
  // ملاحظة: سطر بقيمة 10.00 مفقود بين هذه النقطة وما بعدها (فجوة 301→361
  // في الرصيد التراكمي للمصدر القديم) — لم يُستورَد لعدم توفر بيانه.
  { date: iso('8-10-2026'), cashbox: 'MAIN', amount: 50.00, note: 'مازوت سيارة عادل', oldRef: '917/409' },
  { date: iso('8-10-2026'), cashbox: 'ACCOUNTANT', amount: 6.00, note: 'شادر + حراسة', oldRef: '922/411' },
  { date: iso('8-10-2026'), cashbox: 'ACCOUNTANT', amount: 4.00, note: 'مصروف مركز', oldRef: '922/411' },
  { date: iso('8-10-2026'), cashbox: 'ACCOUNTANT', amount: 4.00, note: 'سكر + شاي + بن للحراس', oldRef: '922/411' },
  { date: iso('8-10-2026'), cashbox: 'ACCOUNTANT', amount: 9.00, note: 'شاي + سكر + بن + وحدات', oldRef: '922/411' },
  { date: iso('8-10-2026'), cashbox: 'MAIN', amount: 100.00, note: 'مصاريف غداء', oldRef: '925/412' },
  { date: iso('10-10-2026'), cashbox: 'ACCOUNTANT', amount: 12.00, note: 'جرة غاز بيد امجد', oldRef: '932/413' },
  { date: iso('10-10-2026'), cashbox: 'ACCOUNTANT', amount: 13.00, note: 'منظفات', oldRef: '932/413' },
  { date: iso('10-10-2026'), cashbox: 'ACCOUNTANT', amount: 8.00, note: 'اكرامية محمود عامل الدير', oldRef: '932/413' },
  { date: iso('10-10-2026'), cashbox: 'ACCOUNTANT', amount: 6.00, note: 'غداء للعمال', oldRef: '932/413' },
  { date: iso('10-10-2026'), cashbox: 'ACCOUNTANT', amount: 8.00, note: 'اكرامية انس مجوز', oldRef: '932/413' },
  { date: iso('10-10-2026'), cashbox: 'ACCOUNTANT', amount: 6.00, note: 'شادر + حراسة', oldRef: '932/413' },
  { date: iso('11-10-2026'), cashbox: 'ACCOUNTANT', amount: 4.00, note: 'اكرامية اب صبحي عامل الدير', oldRef: '936/415' },
  { date: iso('11-10-2026'), cashbox: 'ACCOUNTANT', amount: 7.00, note: 'سكر + شاي + بن + ماء + لودالين', oldRef: '936/415' },
  { date: iso('11-10-2026'), cashbox: 'ACCOUNTANT', amount: 5.00, note: 'فحم + سلوفان + لزاق + جلدة', oldRef: '936/415' },
  { date: iso('11-10-2026'), cashbox: 'MAIN', amount: 37.50, note: 'مازوت سيارة الكيا 530000', oldRef: '937/416' },
  { date: iso('11-10-2026'), cashbox: 'ACCOUNTANT', amount: 1.50, note: 'عصير للضيوف', oldRef: '939/417' },
  { date: iso('11-10-2026'), cashbox: 'ACCOUNTANT', amount: 6.00, note: 'شادر + حراسة', oldRef: '939/417' },
  { date: iso('11-10-2026'), cashbox: 'ACCOUNTANT', amount: 40.00, note: 'متفرقات عزوز', oldRef: '939/417' },
  { date: iso('13-10-2026'), cashbox: 'ACCOUNTANT', amount: 8.00, note: 'سكر + شاي + بن', oldRef: '945/420' },
  { date: iso('13-10-2026'), cashbox: 'ACCOUNTANT', amount: 4.00, note: 'ماء + سلس', oldRef: '945/420' },
  { date: iso('13-10-2026'), cashbox: 'ACCOUNTANT', amount: 24.00, note: 'جرة غاز عدد 2 بيد صالح عبو', oldRef: '947/422' },
  { date: iso('13-10-2026'), cashbox: 'ACCOUNTANT', amount: 1.00, note: 'دخان نبيل مبرمج', oldRef: '947/422' },
  { date: iso('13-10-2026'), cashbox: 'ACCOUNTANT', amount: 5.00, note: 'سكر + شاي + بن', oldRef: '947/422' },
  { date: iso('13-10-2026'), cashbox: 'ACCOUNTANT', amount: 6.00, note: 'شادر + حراسة', oldRef: '947/422' },
  { date: iso('13-10-2026'), cashbox: 'ACCOUNTANT', amount: 4.00, note: 'اكرامية شوفير العقاد', oldRef: '947/422' },
  { date: iso('15-10-2026'), cashbox: 'MAIN', amount: 200.00, note: 'تصليح سيارة عادل كهربجي', oldRef: '967/431' },
  { date: iso('15-10-2026'), cashbox: 'MAIN', amount: 100.00, note: 'مصاريف عارف للمستورة', oldRef: '967/431' },
  { date: iso('15-10-2026'), cashbox: 'ACCOUNTANT', amount: 2.50, note: 'خرطوم حنفية صالح عبو', oldRef: '969/432' },
  { date: iso('15-10-2026'), cashbox: 'ACCOUNTANT', amount: 4.00, note: 'مازوت سيارة عادل', oldRef: '969/432' },
  { date: iso('15-10-2026'), cashbox: 'ACCOUNTANT', amount: 4.00, note: 'سكر + شاي + بن للحراس', oldRef: '969/432' },
  { date: iso('15-10-2026'), cashbox: 'ACCOUNTANT', amount: 6.00, note: 'شادر + حراسة', oldRef: '969/432' },
  { date: iso('15-10-2026'), cashbox: 'ACCOUNTANT', amount: 4.00, note: 'مصروف مركز', oldRef: '969/432' },
  { date: iso('15-10-2026'), cashbox: 'ACCOUNTANT', amount: 10.00, note: 'لزاق + شنيار + شاي', oldRef: '969/432' },
  { date: iso('15-10-2026'), cashbox: 'ACCOUNTANT', amount: 6.00, note: 'غداء للعمال يوم الاربعاء', oldRef: '969/432' },
  { date: iso('15-10-2026'), cashbox: 'ACCOUNTANT', amount: 5.00, note: 'سوزكي احضار دواليب', oldRef: '969/432' },
  { date: iso('15-10-2026'), cashbox: 'ACCOUNTANT', amount: 15.00, note: 'زكاة اموال', oldRef: '969/432' },
  { date: iso('15-10-2026'), cashbox: 'MAIN', amount: 50.00, note: 'مازوت سيارة عادل', oldRef: '970/433' },
];

async function main() {
  const financeRepository = new FinanceRepository();
  const client = await pool.connect();
  try {
    await client.query('begin');

    const companyRow = await client.query(
      `select id from companies where is_active = true order by created_at asc limit 1`,
    );
    const companyId = companyRow.rows[0]?.id;
    if (!companyId) throw new Error('لا توجد شركة نشطة.');

    const mainCashbox = await client.query(
      `select id, currency_code from cashboxes where company_id = $1 and name = $2 limit 1`,
      [companyId, MAIN_CASHBOX_NAME],
    );
    const accountantCashbox = await client.query(
      `select id, currency_code from cashboxes where company_id = $1 and name = $2 limit 1`,
      [companyId, ACCOUNTANT_CASHBOX_NAME],
    );
    if (!mainCashbox.rows[0]) throw new Error(`لم يُعثر على صندوق باسم "${MAIN_CASHBOX_NAME}".`);
    if (!accountantCashbox.rows[0]) throw new Error(`لم يُعثر على صندوق باسم "${ACCOUNTANT_CASHBOX_NAME}".`);

    const cashboxFor = (c: Row['cashbox']) => (c === 'MAIN' ? mainCashbox.rows[0] : accountantCashbox.rows[0]);

    let inserted = 0;
    let skipped = 0;
    for (let i = 0; i < ROWS.length; i++) {
      const row = ROWS[i]!;
      const cashbox = cashboxFor(row.cashbox);
      const voucherNo = `HIST-${row.oldRef.replace('/', '-')}-${i}`;

      const existing = await client.query(`select id from payment_vouchers where voucher_no = $1`, [voucherNo]);
      if (existing.rows[0]) {
        skipped++;
        continue;
      }

      await financeRepository.createPaymentVoucherWithClient(client, {
        voucherNo,
        relatedEntityType: 'expense',
        status: 'confirmed',
        notes: `${row.note} [استيراد من البرنامج القديم — سند ${row.oldRef}]`,
        originalAmount: row.amount,
        originalCurrency: cashbox.currency_code,
        exchangeRateToUsd: 1,
        createdAt: `${row.date}T12:00:00Z`,
        companyId,
        cashboxId: cashbox.id,
      });
      inserted++;
    }

    await client.query('commit');
    console.log(`تم إدخال ${inserted} مصروفاً، وتجاوز ${skipped} موجود مسبقاً (إعادة تشغيل آمنة).`);
  } catch (err) {
    await client.query('rollback');
    console.error('فشل الاستيراد، تم التراجع عن كل شيء:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
