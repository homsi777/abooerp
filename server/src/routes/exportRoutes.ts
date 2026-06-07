import { Router } from 'express';
import { z } from 'zod';
import { requireAnyPermissions } from '../middleware/authorization.js';
import { renderHtmlToPdfBuffer } from '../services/htmlPdfService.js';
import { asyncHandler } from '../utils/http.js';

function sanitizePdfFileName(fileName: string): string {
  const trimmed = fileName.trim() || 'report.pdf';
  const withExt = trimmed.toLowerCase().endsWith('.pdf') ? trimmed : `${trimmed}.pdf`;
  return withExt.replace(/[^\w\u0600-\u06FF.\-()+\s]+/g, '_').replace(/\s+/g, '_');
}

export function createExportRouter() {
  const router = Router();

  router.post(
    '/pdf',
    requireAnyPermissions(['deliveries.read', 'finance.read', 'shipments.read']),
    asyncHandler(async (req, res) => {
      const body = z
        .object({
          html: z.string().min(1).max(2_000_000),
          fileName: z.string().min(1).max(200),
          landscape: z.boolean().optional().default(true),
          title: z.string().max(300).optional(),
        })
        .parse(req.body);

      const buffer = await renderHtmlToPdfBuffer(body.html, body.landscape);
      const safeName = sanitizePdfFileName(body.fileName);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`);
      res.setHeader('Content-Length', String(buffer.length));
      res.send(buffer);
    }),
  );

  return router;
}
