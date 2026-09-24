-- AlterTable
-- Les produits déjà importés reçoivent un handle vide, remplacé au prochain import.
ALTER TABLE "products" ADD COLUMN     "currency_code" TEXT,
ADD COLUMN     "handle" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "image_url" TEXT,
ADD COLUMN     "price" TEXT;

ALTER TABLE "products" ALTER COLUMN "handle" DROP DEFAULT;
