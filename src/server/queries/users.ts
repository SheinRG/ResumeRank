import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/guards";
import type { Role } from "@/lib/validators/enums";

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: Role;
  emailVerified: Date | null;
  createdAt: Date;
}

/** Postgres sorts the native Role enum by declaration order (OWNER, ADMIN, MEMBER, VIEWER). */
export async function listTeam(): Promise<TeamMember[]> {
  await requireUser();
  return db.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      image: true,
      role: true,
      emailVerified: true,
      createdAt: true,
    },
    orderBy: [{ role: "asc" }, { name: "asc" }, { id: "asc" }],
  });
}
