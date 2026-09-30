import { z } from "zod";

function trimStringInput(value: unknown) {
  return typeof value === "string" ? value.trim() : value;
}

function trimBlankToUndefined(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function trimBlankToNull(value: unknown) {
  if (value === null || typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export const uuidSchema = z.string().uuid();
export const opaqueTokenSchema = z.string().trim().min(16).max(512);
export const shortTextSchema = z.string().trim().min(1).max(200);
export const longTextSchema = z.string().trim().min(1).max(5000);
export const normalizedNameSchema = shortTextSchema;
export const isoDateTimeSchema = z.preprocess(
  trimStringInput,
  z.string().datetime({ offset: true })
);
export const futureIsoDateTimeSchema = isoDateTimeSchema.refine(
  (value) => new Date(value).getTime() > Date.now(),
  "Expected a future ISO datetime."
);

export function requiredTextSchema(max: number) {
  return z.string().trim().min(1).max(max);
}

export function optionalTextSchema(max: number) {
  return z.preprocess(trimBlankToUndefined, z.string().min(1).max(max).optional());
}

export function nullableTextSchema(max: number) {
  return z.preprocess(trimBlankToNull, z.string().min(1).max(max).nullable().optional());
}

export function optionalFutureIsoDateTimeSchema() {
  return z.preprocess(trimBlankToUndefined, futureIsoDateTimeSchema.optional());
}

const paginationLimitInputSchema = z.preprocess((input) => {
  if (
    typeof input === "string" ||
    typeof input === "number" ||
    typeof input === "undefined"
  ) {
    return input;
  }

  return "invalid";
}, z.coerce.number().int().min(1).max(200).default(50));

export const paginationQuerySchema = z
  .object({
    cursor: z.string().trim().min(1).max(512).optional(),
    limit: paginationLimitInputSchema
  })
  .strict();

export function idParamsSchema<const T extends string>(...names: T[]) {
  const shape = Object.fromEntries(names.map((name) => [name, uuidSchema])) as Record<
    T,
    typeof uuidSchema
  >;
  return z.object(shape).strict();
}

export const uuidParamSchema = idParamsSchema("id");
