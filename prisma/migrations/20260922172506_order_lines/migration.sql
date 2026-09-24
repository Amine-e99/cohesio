-- CreateTable
CREATE TABLE "order_lines" (
    "id" SERIAL NOT NULL,
    "shop_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_lines_shop_id_product_id_processed_at_idx" ON "order_lines"("shop_id", "product_id", "processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_lines_shop_id_order_id_product_id_key" ON "order_lines"("shop_id", "order_id", "product_id");
