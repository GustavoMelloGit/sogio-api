CREATE TABLE "subscription_history_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"subscription_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"type" varchar(30) NOT NULL,
	"resulting_status" varchar(20) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"access_until" timestamp with time zone,
	"reason" varchar(255)
);
--> statement-breakpoint
ALTER TABLE "subscription_history_entries" ADD CONSTRAINT "subscription_history_entries_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_history_entries" ADD CONSTRAINT "subscription_history_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_history_entries" ADD CONSTRAINT "subscription_history_entries_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscription_history_entries_user_id_occurred_at_idx" ON "subscription_history_entries" USING btree ("user_id","occurred_at" DESC NULLS LAST);