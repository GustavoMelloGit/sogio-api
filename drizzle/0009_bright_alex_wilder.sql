CREATE TABLE "processed_gateway_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_event_id" varchar(255) NOT NULL,
	"type" varchar(50) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_gateway_events_external_event_id_unique" UNIQUE("external_event_id")
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "external_event_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "plans_external_price_reference_idx" ON "plans" USING btree ("external_price_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_external_reference_idx" ON "subscriptions" USING btree ("external_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_external_customer_reference_idx" ON "subscriptions" USING btree ("external_customer_reference");