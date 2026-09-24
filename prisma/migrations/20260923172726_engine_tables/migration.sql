-- CreateTable
CREATE TABLE "products" (
    "id" SERIAL NOT NULL,
    "shop_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_pairs" (
    "id" SERIAL NOT NULL,
    "shop_id" TEXT NOT NULL,
    "product_a" TEXT NOT NULL,
    "product_b" TEXT NOT NULL,
    "co_count" INTEGER NOT NULL,
    "support" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "lift" DOUBLE PRECISION NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_pairs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_stats" (
    "id" SERIAL NOT NULL,
    "shop_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "total_qty" INTEGER NOT NULL,
    "orders_count" INTEGER NOT NULL,
    "last_sold_at" TIMESTAMP(3),
    "classification" TEXT NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_shop_id_product_id_key" ON "products"("shop_id", "product_id");

-- CreateIndex
CREATE INDEX "product_pairs_shop_id_product_a_idx" ON "product_pairs"("shop_id", "product_a");

-- CreateIndex
CREATE UNIQUE INDEX "product_pairs_shop_id_product_a_product_b_key" ON "product_pairs"("shop_id", "product_a", "product_b");

-- CreateIndex
CREATE UNIQUE INDEX "product_stats_shop_id_product_id_key" ON "product_stats"("shop_id", "product_id");
