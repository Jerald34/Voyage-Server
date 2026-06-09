import { z } from "zod";

export const uuidSchema = z.string().uuid();
export const opaqueTokenSchema = z.string().trim().min(16).max(512);
export const shortTextSchema = z.string().trim().min(1).max(200);
export const longTextSchema = z.string().trim().min(1).max(5000);
export const normalizedNameSchema = shortTextSchema;

export const paginationQuerySchema = z
  .object({
    cursor: z.string().trim().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50)
  })
  .strict();

export function idParamsSchema<const T extends string>(...names: T[]) {
  const shape = {} as { [K in T]: typeof uuidSchema };

  for (const name of names) {
    shape[name] = uuidSchema;
  }

  return z.object(shape).strict();
}

export const uuidParamSchema = idParamsSchema("id");
