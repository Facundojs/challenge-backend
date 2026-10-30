import { Router } from 'express';
import type { Db } from '@challenge/db';
import { userIdParam } from '../schemas';
import { getPortfolio } from '../services/portfolio';

export const portfolioRouter = (db: Db) =>
  Router().get('/users/:userId/portfolio', async (req, res) => {
    res.json(await getPortfolio(db, userIdParam.parse(req.params.userId)));
  });
