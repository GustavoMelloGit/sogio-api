ALTER TABLE "plans" ADD COLUMN "capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "plans" SET "capabilities" = jsonb_build_object('max_properties', "max_properties");--> statement-breakpoint
ALTER TABLE "plans" DROP COLUMN "max_properties";