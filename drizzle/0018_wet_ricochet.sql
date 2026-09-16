CREATE TABLE "external_sign_in_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"provider" varchar(20) NOT NULL,
	"state_digest" varchar(64) NOT NULL,
	"code_challenge" varchar(255) NOT NULL,
	"nonce_digest" varchar(64) NOT NULL,
	"return_to" varchar(512),
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "external_sign_in_requests_state_digest_unique" UNIQUE("state_digest")
);
--> statement-breakpoint
CREATE TABLE "linked_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"user_id" uuid NOT NULL,
	"provider" varchar(20) NOT NULL,
	"subject" varchar(255) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "linked_identities" ADD CONSTRAINT "linked_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "external_sign_in_requests_expires_at_idx" ON "external_sign_in_requests" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "linked_identities_provider_subject_idx" ON "linked_identities" USING btree ("provider","subject");--> statement-breakpoint
CREATE UNIQUE INDEX "linked_identities_user_id_provider_idx" ON "linked_identities" USING btree ("user_id","provider");