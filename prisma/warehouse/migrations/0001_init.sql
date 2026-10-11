-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "zone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "Movement" (
    "seq" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "fromLocationId" TEXT,
    "toLocationId" TEXT,
    "qty" INTEGER NOT NULL,
    "reasonCode" TEXT,
    "ref" TEXT,
    "counterpartWarehouseId" TEXT,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "StockBalance" (
    "skuId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,

    PRIMARY KEY ("skuId", "locationId")
);

-- CreateTable
CREATE TABLE "PickList" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL,
    "assignedUserId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PickLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pickListId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "qtyRequested" INTEGER NOT NULL,
    CONSTRAINT "PickLine_pickListId_fkey" FOREIGN KEY ("pickListId") REFERENCES "PickList" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CountTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "assignedUserId" TEXT,
    "status" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Exception" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "movementIds" TEXT NOT NULL,
    "skuId" TEXT,
    "locationId" TEXT,
    "deviceId" TEXT,
    "details" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "resolvedBy" TEXT,
    "resolution" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME
);

-- CreateTable
CREATE TABLE "DeviceClockSample" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "deviceId" TEXT NOT NULL,
    "deviceTime" DATETIME NOT NULL,
    "serverTime" DATETIME NOT NULL,
    "skewMs" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Location_code_key" ON "Location"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Movement_id_key" ON "Movement"("id");

-- CreateIndex
CREATE INDEX "Movement_skuId_toLocationId_occurredAt_idx" ON "Movement"("skuId", "toLocationId", "occurredAt");

-- CreateIndex
CREATE INDEX "Movement_skuId_fromLocationId_occurredAt_idx" ON "Movement"("skuId", "fromLocationId", "occurredAt");

-- CreateIndex
CREATE INDEX "Movement_type_ref_idx" ON "Movement"("type", "ref");

-- CreateIndex
CREATE INDEX "Exception_status_type_idx" ON "Exception"("status", "type");

