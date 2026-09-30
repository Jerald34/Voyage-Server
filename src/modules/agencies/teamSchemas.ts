import { z } from "zod";
import { uuidSchema } from "../../http/requestSchemas";

export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(["ADMIN", "STAFF"])
}).strict();

export const changeRoleSchema = z.object({
  role: z.enum(["ADMIN", "STAFF"])
}).strict();

export const transferOwnershipSchema = z.object({
  targetMembershipId: uuidSchema
}).strict();
