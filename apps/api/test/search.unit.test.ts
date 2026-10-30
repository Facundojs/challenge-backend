import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { searchQuery } from '../src/schemas';

describe('searchQuery', () => {
  it.each([
    ['  AaA ', 'aaa'],
    ['BBB', 'bbb'],
    ['Telecom Argentina', 'telecom argentina'],
  ])('normaliza %j a %j', (raw, expected) => {
    expect(searchQuery.parse(raw)).toBe(expected);
  });

  it.each(['', '   '])('rechaza %j', (raw) => {
    expect(searchQuery.safeParse(raw).success).toBe(false);
  });
});

describe('GET /instruments', () => {
  it('400 con una query vacía o de espacios, sin tocar la base', async () => {
    const app = createApp({} as never);
    expect((await request(app).get('/instruments?q=%20%20')).status).toBe(400);
    expect((await request(app).get('/instruments')).status).toBe(400);
  });
});
