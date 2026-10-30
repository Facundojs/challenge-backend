export const num = (v: string | number | null | undefined): number => Number(v ?? 0);
export const numOrNull = (v: string | number | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));
export const round2 = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100;
export const cents = (v: number): number => Math.round(v * 100);

// Variación porcentual de `current` respecto de `base`; null si falta alguno o la base es 0.
export const pctChange = (current: number | null, base: number | null): number | null =>
  current === null || !base ? null : round2((current / base - 1) * 100);

// Acciones enteras que se pueden comprar con `amount` pesos a `price`.
export const sharesFor = (amount: number, price: number): number => Math.floor(amount / price + 1e-9);
