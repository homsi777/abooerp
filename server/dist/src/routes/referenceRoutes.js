import { Router } from 'express';
import { asyncHandler } from '../utils/http.js';
export function createReferenceRouter(options) {
    const { service, createSchema, updateSchema } = options;
    const router = Router();
    router.get('/', asyncHandler(async (_req, res) => {
        const items = await service.list();
        res.json({ success: true, data: items });
    }));
    router.get('/:id', asyncHandler(async (req, res) => {
        const id = String(req.params.id);
        const item = await service.getById(id);
        if (!item) {
            res.status(404).json({ success: false, error: 'Not found' });
            return;
        }
        res.json({ success: true, data: item });
    }));
    router.post('/', asyncHandler(async (req, res) => {
        const payload = createSchema.parse(req.body);
        const item = await service.create(payload);
        res.status(201).json({ success: true, data: item });
    }));
    router.put('/:id', asyncHandler(async (req, res) => {
        const id = String(req.params.id);
        const payload = updateSchema.parse(req.body);
        const item = await service.update(id, payload);
        if (!item) {
            res.status(404).json({ success: false, error: 'Not found' });
            return;
        }
        res.json({ success: true, data: item });
    }));
    router.delete('/:id', asyncHandler(async (req, res) => {
        const removed = await service.remove(String(req.params.id));
        if (!removed) {
            res.status(404).json({ success: false, error: 'Not found' });
            return;
        }
        res.json({ success: true });
    }));
    return router;
}
