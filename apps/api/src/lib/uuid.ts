import { createHash } from 'node:crypto';

// UUID v5 (RFC 4122): SHA-1 de namespace + nombre, con bits de versión y variante.
export function uuidv5(name: string, namespace: string): string {
  const hash = createHash('sha1').update(Buffer.from(namespace.replace(/-/g, ''), 'hex')).update(name, 'utf8').digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = hash.subarray(0, 16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
