import { db } from "@resumerank/core/db";
import { requireMember } from "@/lib/auth/guards";
import type { Role } from "@resumerank/core/validators/enums";

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
  const user = await requireMember();
  return db.user.findMany({
    where: { companyId: user.companyId },
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

export interface PendingInvite {
  id: string;
  email: string;
  role: Role;
  expiresAt: Date;
  invitedByName: string;
}

export async function listPendingInvites(): Promise<PendingInvite[]> {
  const user = await requireMember();
  const invites = await db.companyInvite.findMany({
    where: {
      companyId: user.companyId,
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: { invitedBy: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return invites.map((invite) => ({
    id: invite.id,
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expiresAt,
    invitedByName: invite.invitedBy.name,
  }));
}
