-- AlterTable
ALTER TABLE "User" ADD COLUMN     "directoryUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_companyId_directoryUserId_key" ON "User"("companyId", "directoryUserId");
