import { z } from "zod";

export const uuidSchema = z.string().uuid();
export const opaqueTokenSchema = z.string().trim().min(16).max(512);
export const shortTextSchema = z.string().trim().min(1).max(200);
export const longTextSchema = z.string().trim().min(1).max(5000);
export const normalizedNameSchema = shortTextSchema;

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
