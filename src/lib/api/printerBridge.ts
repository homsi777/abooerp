import { httpClient } from './httpClient';

export type ResolvedPrinterRoute = {
  id: string;
  document_type: string;
  printer_id: string;
  copies: number;
  target: string;
  route_scope: 'branch' | 'company';
  printer_name: string;
  printer_code: string;
};

export async function resolvePrinterRoute(documentType: string, branchId?: string) {
  const query = new URLSearchParams();
  query.set('documentType', documentType);
  if (branchId) query.set('branchId', branchId);
  return httpClient.get<ResolvedPrinterRoute>(`/printer-routes/resolve?${query.toString()}`);
}

export async function printDocumentViaResolvedRoute(params: {
  documentType: string;
  branchId?: string;
  payloadType: 'raw' | 'html' | 'text';
  payloadRef?: string;
  content?: string;
  copies?: number;
}) {
  const resolved = await resolvePrinterRoute(params.documentType, params.branchId);
  if (!window.printer?.print) {
    throw new Error('Electron printer bridge is unavailable in this runtime.');
  }
  const printResult = await window.printer.print({
    documentType: params.documentType,
    printerTarget: resolved.target,
    copies: params.copies ?? resolved.copies,
    payloadType: params.payloadType,
    payloadRef: params.payloadRef,
    content: params.content,
  });

  return { resolved, printResult };
}
