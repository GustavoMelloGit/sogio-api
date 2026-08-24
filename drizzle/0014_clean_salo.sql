ALTER TABLE "external_booking_sources" ALTER COLUMN "platform_name" SET DATA TYPE varchar(50);--> statement-breakpoint
ALTER TABLE "external_booking_sources" ALTER COLUMN "sync_url" SET DATA TYPE varchar(2048);--> statement-breakpoint
DROP TYPE "public"."calendar_sync_platforms";