import type {
  Directory,
  DirectorySyncEvent,
  DirectorySyncRequest,
  DirectorySyncResponse,
} from "@boxyhq/saml-jackson";
import { z } from "zod";

import { db } from "../db";
import { logActivity } from "../activity";
import { revokeUserSessions } from "../auth/sessions";
import { log } from "../observability/log";
import { emailDomain } from "./domains";
import { SSO_PRODUCT, ssoControllers } from "./jackson";

/**
 * SCIM provisioning: a company's identity provider adds, updates and removes
 * its people through the embedded directory-sync service, and each change
 * arrives here as an event. Like SSO sign-in this runs with no signed-in
 * actor: the directory's bearer token identifies the company, so the event's
 * tenant is trusted and audit rows carry no actor.
 */

const directoryUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().trim().toLowerCase().email(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  active: z.boolean(),
});

type DirectoryUser = z.infer<typeof directoryUserSchema>;

function displayName(user: DirectoryUser): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return name || user.email.slice(0, user.email.indexOf("@"));
}

/** The company's directory, if it has one. One per company, like its SSO connection. */
export async function companyDirectory(companyId: string): Promise<Directory | null> {
  const { directorySyncController } = await ssoControllers();
  const { data } = await directorySyncController.directories.getByTenantAndProduct(companyId, SSO_PRODUCT);
  return data?.find((directory) => !directory.deactivated) ?? null;
}

/**
 * Adds or refreshes a person the directory says is active. Only addresses on
 * the company's verified domains are accepted — the same rule SSO sign-in
 * follows — and someone already in another workspace is left alone.
 */
async function provision(companyId: string, user: DirectoryUser): Promise<void> {
  const domain = emailDomain(user.email);
  const claim = domain
    ? await db.companyDomain.findFirst({
        where: { companyId, domain, verifiedAt: { not: null } },
        select: { id: true },
      })
    : null;
  if (!claim) {
    log.warn("scim.provision_skipped", { companyId, reason: "unverified_domain", domain });
    return;
  }

  const name = displayName(user);
  await db.$transaction(async (tx) => {
    const linked = await tx.user.findUnique({
      where: { companyId_directoryUserId: { companyId, directoryUserId: user.id } },
      select: { id: true, name: true, email: true },
    });
    if (linked) {
      // A renamed address moves with the person, unless another account has it.
      const emailTaken =
        linked.email !== user.email &&
        (await tx.user.findUnique({ where: { email: user.email }, select: { id: true } })) !== null;
      const email = emailTaken ? linked.email : user.email;
      if (emailTaken) log.warn("scim.email_change_skipped", { companyId, reason: "email_taken" });
      if (linked.name === name && linked.email === email) return;

      await tx.user.update({ where: { id: linked.id }, data: { name, email } });
      await logActivity(
        {
          companyId,
          actorId: null,
          action: "user.directory_update",
          entityType: "user",
          entityId: linked.id,
          summary: `directory sync updated ${name}'s profile`,
        },
        tx,
      );
      return;
    }

    const existing = await tx.user.findUnique({
      where: { email: user.email },
      select: { id: true, companyId: true, emailVerified: true },
    });
    if (existing?.companyId && existing.companyId !== companyId) {
      log.warn("scim.provision_skipped", { companyId, reason: "other_workspace" });
      return;
    }

    const joining = !existing?.companyId;
    const provisioned = existing
      ? await tx.user.update({
          where: { id: existing.id },
          data: {
            directoryUserId: user.id,
            emailVerified: existing.emailVerified ?? new Date(),
            ...(joining ? { companyId, role: "MEMBER" } : {}),
          },
          select: { id: true, name: true },
        })
      : await tx.user.create({
          data: {
            name,
            email: user.email,
            emailVerified: new Date(),
            companyId,
            role: "MEMBER",
            directoryUserId: user.id,
          },
          select: { id: true, name: true },
        });
    if (joining) {
      await logActivity(
        {
          companyId,
          actorId: null,
          action: "user.provision",
          entityType: "user",
          entityId: provisioned.id,
          summary: `directory sync added ${provisioned.name}`,
        },
        tx,
      );
    }
  });
}

/**
 * Removes a person the directory deactivated or deleted, ending their
 * sessions, exactly as an admin removing them would. Owners are never removed
 * this way: losing the last owner would strand the workspace, so their
 * offboarding stays a human decision.
 */
async function deprovision(companyId: string, user: DirectoryUser): Promise<void> {
  await db.$transaction(async (tx) => {
    const target =
      (await tx.user.findUnique({
        where: { companyId_directoryUserId: { companyId, directoryUserId: user.id } },
        select: { id: true, name: true, role: true },
      })) ??
      (await tx.user.findFirst({
        where: { email: user.email, companyId },
        select: { id: true, name: true, role: true },
      }));
    if (!target) return;
    if (target.role === "OWNER") {
      log.warn("scim.deprovision_skipped", { companyId, reason: "owner" });
      return;
    }

    await revokeUserSessions(tx, target.id);
    await tx.user.update({
      where: { id: target.id },
      data: { companyId: null, role: "MEMBER", directoryUserId: null, sessionVersion: { increment: 1 } },
    });
    await logActivity(
      {
        companyId,
        actorId: null,
        action: "user.deprovision",
        entityType: "user",
        entityId: target.id,
        summary: `directory sync removed ${target.name}`,
        metadata: { role: target.role },
      },
      tx,
    );
  });
}

/** Group events are stored by the directory service but don't change access here. */
export async function applyDirectoryEvent(event: DirectorySyncEvent): Promise<void> {
  if (!event.event.startsWith("user.")) return;
  const parsed = directoryUserSchema.safeParse(event.data);
  if (!parsed.success) {
    log.warn("scim.event_unreadable", { companyId: event.tenant, event: event.event });
    return;
  }
  if (event.event === "user.deleted" || !parsed.data.active) {
    await deprovision(event.tenant, parsed.data);
  } else {
    await provision(event.tenant, parsed.data);
  }
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Runs SCIM requests one at a time per process. The directory-sync service
 * keeps the current request's tenant and event callback on shared objects,
 * so two overlapping requests could otherwise act on each other's tenant.
 * Directory traffic is a trickle of small writes, so the queue costs little.
 */
export function handleScimRequest(request: DirectorySyncRequest): Promise<DirectorySyncResponse> {
  const run = queue.then(async () => {
    const { directorySyncController } = await ssoControllers();
    return directorySyncController.requests.handle(request, applyDirectoryEvent);
  });
  queue = run.catch(() => undefined);
  return run;
}
