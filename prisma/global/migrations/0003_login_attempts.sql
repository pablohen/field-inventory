
-- CreateTable
CREATE TABLE "LoginAttempt" (
    "deviceId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("deviceId", "username")
);

