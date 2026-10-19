import { userInfo } from "node:os";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";

// Variables already set win, so DATABASE_URL=... points it at another database.
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)), quiet: true });

// Imported only after the environment is loaded: `db` connects at import.
const { db } = await import("../src/db");
const { grantStaff, listStaff, revokeStaff } = await import("../src/staff/members");
const { DomainError } = await import("../src/services/errors");

const USAGE = `Usage: npm run staff -- <command>

  list                          everyone with staff access, and whether they have a second factor
  grant <email> support|admin   give an existing account staff access, or change its role
  revoke <email>                take it away; any support session they're in ends at once
`;

function write(line = ""): void {
  process.stdout.write(`${line}\n`);
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const by = { userId: null, email: `cli:${userInfo().username}` };
const [command, email, role] = process.argv.slice(2);

try {
  switch (command) {
    case "list": {
      const staff = await listStaff();
      if (staff.length === 0) write("No one has staff access.");
      for (const member of staff) {
        const factor = member.hasSecondFactor ? "" : "  (no second factor: the console refuses them until they add one)";
        write(`${member.email}  ${member.role.toLowerCase()}  since ${member.createdAt.toISOString().slice(0, 10)}${factor}`);
      }
      break;
    }
    case "grant": {
      if (!email || (role !== "support" && role !== "admin")) fail(USAGE);
      const grant = await grantStaff(by, email, role === "admin" ? "ADMIN" : "SUPPORT");
      write(
        grant.previous === null
          ? `${grant.email} is now ${role} staff.`
          : `${grant.email} was ${grant.previous.toLowerCase()} staff and is now ${role}.`,
      );
      if (!grant.hasSecondFactor) {
        write("They have no second factor yet, so the console will refuse them until they set one up.");
      }
      break;
    }
    case "revoke": {
      if (!email) fail(USAGE);
      const result = await revokeStaff(by, email);
      write(result.revoked ? `${result.email} no longer has staff access.` : `${result.email} wasn't staff.`);
      break;
    }
    default:
      fail(USAGE);
  }
} catch (error) {
  if (error instanceof DomainError) fail(error.message);
  throw error;
} finally {
  await db.$disconnect();
}
