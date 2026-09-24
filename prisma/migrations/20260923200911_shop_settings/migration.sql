-- CreateTable
CREATE TABLE "shop_settings" (
    "id" SERIAL NOT NULL,
    "shop_id" TEXT NOT NULL,
    "min_co_count" INTEGER NOT NULL DEFAULT 8,
    "min_confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
    "min_lift" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "dead_days" INTEGER NOT NULL DEFAULT 30,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shop_settings_shop_id_key" ON "shop_settings"("shop_id");
