export const round = (n, d = 2) => {
  const f = 10 ** d;
  return Math.round((n + Number.EPSILON) * f) / f;
};
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
