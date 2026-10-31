-- MoMo is the only payment method; cards are not offered
ALTER TABLE "app"."platform_settings" DROP COLUMN "cardEnabled";
