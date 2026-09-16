ALTER TABLE "subscriptions" ADD COLUMN "plan_chosen_at" timestamp with time zone;--> statement-breakpoint
UPDATE "subscriptions" SET "plan_chosen_at" = "created_at" WHERE "plan_chosen_at" IS NULL;
