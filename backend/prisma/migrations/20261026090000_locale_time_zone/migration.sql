-- Locale and time zone for dates and numbers: a default per workspace, and
-- an optional choice per person that overrides it (locale.ts).
--
-- Expand only: defaulted workspace columns and nullable personal ones.

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'en-US',
ADD COLUMN     "timeZone" TEXT NOT NULL DEFAULT 'UTC';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "locale" TEXT,
ADD COLUMN     "timeZone" TEXT;

