-- AlterTable
ALTER TABLE "PublishAttempt" ADD COLUMN     "title" TEXT;

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "titleMaxLength" INTEGER NOT NULL DEFAULT 70,
ADD COLUMN     "titleTemplate" TEXT;

-- AlterTable
ALTER TABLE "Suggestion" ADD COLUMN     "aiTitle" TEXT,
ADD COLUMN     "approvedTitle" TEXT,
ADD COLUMN     "titleTemplate" TEXT;
