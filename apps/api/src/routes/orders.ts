import { Router } from 'express';
import type { Db } from '@challenge/db';
import { normalizeKey } from '../lib/idempotency';
import { orderBody } from '../schemas';
import { placeOrder } from '../services/orders';

export const ordersRouter = (db: Db) =>
  Router().post('/orders', async (req, res) => {
    const body = orderBody.parse(req.body);
    const rawKey = req.header('Idempotency-Key');
    const idempotencyKey = rawKey === undefined ? undefined : normalizeKey(rawKey);

    const { order, replayed } = await placeOrder(db, { ...body, idempotencyKey });
    if (replayed) res.set('Idempotency-Replayed', 'true');
    res.status(replayed ? 200 : 201).json(order);
  });
