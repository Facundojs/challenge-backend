import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';

// Estos casos fallan antes de tocar la base, así que alcanza con un Db vacío.
const app = createApp({} as never);
const post = () => request(app).post('/orders').set('Content-Type', 'application/json');

describe('errorHandler', () => {
  it('JSON malformado: 400 y no 500', async () => {
    const res = await post().send('{"userId": ');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'JSON inválido' });
  });

  it('body demasiado grande: 413', async () => {
    const res = await post().send(JSON.stringify({ padding: 'x'.repeat(200_000) }));
    expect(res.status).toBe(413);
  });

  it('body que no cumple el esquema: 400 con el detalle', async () => {
    const res = await post().send({ userId: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Request inválido');
    expect(res.body.details.length).toBeGreaterThan(0);
  });
});
