-- Password policy: per-company minimum length and breached-password check,
-- and a flag holding a sign-in whose password falls short of it.
--
-- Expand only: new columns with defaults that keep today's behaviour (eight
-- characters, no breach check, no sign-in held).

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "passwordBreachCheck" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "passwordMinLength" INTEGER NOT NULL DEFAULT 8;

-- AlterTable
ALTER TABLE "LoginSession" ADD COLUMN     "passwordChangeRequired" BOOLEAN NOT NULL DEFAULT false;
