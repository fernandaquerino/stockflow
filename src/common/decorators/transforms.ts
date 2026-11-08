import { Transform } from 'class-transformer';

/** Trims surrounding whitespace of string inputs (non-strings are left for validators to reject). */
export const Trim = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

/** Trims and lower-cases e-mail addresses so uniqueness is case-insensitive. */
export const NormalizeEmail = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );

/** Converts the query-string values "true"/"false" into booleans. */
export const ToBoolean = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  );
