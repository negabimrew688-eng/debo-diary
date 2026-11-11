/** validate(schema, 'body' | 'query' | 'params') replaces req[part] with the parsed (coerced, stripped) value. */
export const validate = (schema, part = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[part]);
  if (!result.success) return next(result.error);
  if (part === 'query') {
    Object.defineProperty(req, 'query', { value: result.data, writable: true, configurable: true });
  } else {
    req[part] = result.data;
  }
  next();
};
