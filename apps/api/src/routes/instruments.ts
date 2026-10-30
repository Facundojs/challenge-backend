import { Router } from 'express';
import type { Db } from '@challenge/db';
import { searchQuery } from '../schemas';
import { searchInstruments } from '../services/instruments';

export const instrumentsRouter = (db: Db) =>
  Router().get('/instruments', async (req, res) => {
    res.json(await searchInstruments(db, searchQuery.parse(req.query.q)));
  });
