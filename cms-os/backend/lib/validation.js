/**
 * Validation bridge — wraps the shared schema engine for backend use.
 * The backend ALWAYS validates before staging and again before commit, so an
 * invalid write is impossible even if the UI is bypassed (Zero Drift rule).
 */
import { validate, coerce, defaultsFor } from '../../shared/schema-engine.js';

export function validateContent(schema, value) {
  // 1. Detect drift (unknown keys) on the RAW input and reject it loudly —
  //    coercion would otherwise silently strip unknown fields.
  const driftErrors = validate(schema, value).errors.filter((e) => /Unknown field/.test(e.message));
  // 2. Coerce loosely-typed form input into correct types, then validate.
  const coerced = coerce(schema, value);
  const result = validate(schema, coerced);
  // 3. Merge (dedupe by path+message).
  const seen = new Set(result.errors.map((e) => e.path + e.message));
  const errors = [...result.errors];
  for (const e of driftErrors) if (!seen.has(e.path + e.message)) errors.push(e);
  return { valid: errors.length === 0, errors, value: coerced };
}

export { defaultsFor };

/** Throw a 422-style error object if invalid. */
export function assertValid(schema, value) {
  const { valid, errors, value: coerced } = validateContent(schema, value);
  if (!valid) {
    const err = new Error('Content failed schema validation.');
    err.status = 422;
    err.errors = errors;
    throw err;
  }
  return coerced;
}
