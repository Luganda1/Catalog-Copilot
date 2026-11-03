-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'PUBLISHING', 'PUBLISHED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TagMode" AS ENUM ('ADD', 'REPLACE');

-- CreateEnum
CREATE TYPE "PublishAttemptStatus" AS ENUM ('SUCCEEDED', 'FAILED', 'CONFLICT');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Suggestion" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sourceTitle" TEXT NOT NULL,
    "sourceDescriptionHtml" TEXT NOT NULL,
    "sourceTags" TEXT[],
    "aiDescriptionHtml" TEXT NOT NULL,
    "aiTags" TEXT[],
    "missingInfo" TEXT[],
    "warnings" TEXT[],
    "aiModel" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "approvedDescriptionHtml" TEXT,
    "approvedTags" TEXT[],
    "publishTags" BOOLEAN NOT NULL DEFAULT false,
    "tagMode" "TagMode",
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "Suggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishAttempt" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "suggestionId" TEXT NOT NULL,
    "status" "PublishAttemptStatus" NOT NULL,
    "descriptionHtml" TEXT,
    "tags" TEXT[],
    "errorMessage" TEXT,
    "errorDetails" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublishAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_domain_key" ON "Shop"("domain");

-- CreateIndex
CREATE INDEX "Suggestion_shopId_productId_idx" ON "Suggestion"("shopId", "productId");

-- CreateIndex
CREATE INDEX "Suggestion_shopId_createdAt_idx" ON "Suggestion"("shopId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Suggestion_id_shopId_key" ON "Suggestion"("id", "shopId");

-- CreateIndex
CREATE INDEX "PublishAttempt_shopId_createdAt_idx" ON "PublishAttempt"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "PublishAttempt_suggestionId_idx" ON "PublishAttempt"("suggestionId");

-- AddForeignKey
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishAttempt" ADD CONSTRAINT "PublishAttempt_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishAttempt" ADD CONSTRAINT "PublishAttempt_suggestionId_shopId_fkey" FOREIGN KEY ("suggestionId", "shopId") REFERENCES "Suggestion"("id", "shopId") ON DELETE CASCADE ON UPDATE CASCADE;
