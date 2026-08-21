ALTER TABLE "plans" ADD COLUMN "external_product_reference" varchar(255);--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "external_event_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "plans_external_product_reference_idx" ON "plans" USING btree ("external_product_reference");