import { z } from 'zod';

export const orderBody = z
  .object({
    userId: z.number().int().positive(),
    instrumentId: z.number().int().positive(),
    side: z.enum(['BUY', 'SELL']),
    type: z.enum(['MARKET', 'LIMIT']),
    size: z.number().int().positive().optional(),
    amount: z.number().positive().optional(),
    price: z.number().positive().optional(),
  })
  .strict()
  .refine((b) => (b.size === undefined) !== (b.amount === undefined), { message: 'Enviar exactamente uno de: size, amount' })
  .refine((b) => (b.type === 'LIMIT') === (b.price !== undefined), { message: 'price es obligatorio en LIMIT y no se admite en MARKET' });

export const userIdParam = z.coerce.number().int().positive();

// Se normaliza acá, antes de llegar a la consulta y al cache: ambos reciben siempre la misma forma.
export const searchQuery = z.string().trim().toLowerCase().min(1);
