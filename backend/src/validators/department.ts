import { z } from "zod";

const departmentNameSchema = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters")
  .max(60, "Name must be at most 60 characters");

export const departmentCreateSchema = z.object({
  name: departmentNameSchema,
});
export type DepartmentCreateInput = z.infer<typeof departmentCreateSchema>;

export const departmentRenameSchema = z.object({
  id: z.string().min(1),
  name: departmentNameSchema,
});
export type DepartmentRenameInput = z.infer<typeof departmentRenameSchema>;

export const departmentIdSchema = z.object({
  id: z.string().min(1),
});
export type DepartmentIdInput = z.infer<typeof departmentIdSchema>;

export const departmentMemberSchema = z.object({
  departmentId: z.string().min(1),
  userId: z.string().min(1, "Choose a teammate"),
});
export type DepartmentMemberInput = z.infer<typeof departmentMemberSchema>;

export const jobAssignmentSchema = z.object({
  jobId: z.string().min(1),
  userId: z.string().min(1, "Choose a teammate"),
});
export type JobAssignmentInput = z.infer<typeof jobAssignmentSchema>;

/** An empty `departmentId` files the job under no department. */
export const jobDepartmentSchema = z.object({
  jobId: z.string().min(1),
  departmentId: z.string().transform((value) => value || null),
});
export type JobDepartmentInput = z.infer<typeof jobDepartmentSchema>;
