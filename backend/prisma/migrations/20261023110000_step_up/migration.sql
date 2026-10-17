-- Step-up re-authentication: when a sign-in last re-proved who it is.
--
-- Expand only: a nullable column; null means "only the sign-in itself".

-- AlterTable
ALTER TABLE "LoginSession" ADD COLUMN     "reauthenticatedAt" TIMESTAMP(3);
