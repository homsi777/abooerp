import type { KeyboardEvent } from 'react';

export const VOUCHER_GRID_FIELDS = ['kind', 'date', 'party', 'amount', 'currency', 'cashbox', 'notes'] as const;

export type VoucherGridField = (typeof VOUCHER_GRID_FIELDS)[number];

export function focusVoucherGridField(rowIndex: number, field: VoucherGridField) {
  const el = document.querySelector<HTMLElement>(`[data-voucher-row="${rowIndex}"][data-voucher-field="${field}"]`);
  if (!el) return;
  el.focus();
  if (el instanceof HTMLInputElement && el.type !== 'date') {
    el.select();
  }
}

export function navigateVoucherGridField(
  rowIndex: number,
  field: VoucherGridField,
  direction: 'next' | 'prev' | 'down' | 'up',
  rowCount: number,
) {
  const fieldIndex = VOUCHER_GRID_FIELDS.indexOf(field);
  if (fieldIndex < 0) return;

  if (direction === 'next') {
    if (fieldIndex < VOUCHER_GRID_FIELDS.length - 1) {
      focusVoucherGridField(rowIndex, VOUCHER_GRID_FIELDS[fieldIndex + 1]);
      return;
    }
    if (rowIndex + 1 < rowCount) focusVoucherGridField(rowIndex + 1, VOUCHER_GRID_FIELDS[0]);
    return;
  }

  if (direction === 'prev') {
    if (fieldIndex > 0) {
      focusVoucherGridField(rowIndex, VOUCHER_GRID_FIELDS[fieldIndex - 1]);
      return;
    }
    if (rowIndex > 0) focusVoucherGridField(rowIndex - 1, VOUCHER_GRID_FIELDS[VOUCHER_GRID_FIELDS.length - 1]);
    return;
  }

  if (direction === 'down' && rowIndex + 1 < rowCount) {
    focusVoucherGridField(rowIndex + 1, field);
    return;
  }

  if (direction === 'up' && rowIndex > 0) {
    focusVoucherGridField(rowIndex - 1, field);
  }
}

export function handleVoucherGridKeyboard(
  e: KeyboardEvent,
  rowIndex: number,
  field: VoucherGridField,
  rowCount: number,
  options?: { skipEnter?: boolean },
) {
  if (e.key === 'Enter' && !e.shiftKey && !options?.skipEnter) {
    e.preventDefault();
    navigateVoucherGridField(rowIndex, field, 'next', rowCount);
    return true;
  }
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    navigateVoucherGridField(rowIndex, field, 'next', rowCount);
    return true;
  }
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    navigateVoucherGridField(rowIndex, field, 'prev', rowCount);
    return true;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    navigateVoucherGridField(rowIndex, field, 'down', rowCount);
    return true;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    navigateVoucherGridField(rowIndex, field, 'up', rowCount);
    return true;
  }
  return false;
}
