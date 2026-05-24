import { z } from "zod";

export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(["ADMIN", "STAFF"])
});

export const changeRoleSchema = z.object({
  role: z.enum(["ADMIN", "STAFF"])
});
