CREATE TABLE "app_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"client_name" varchar(255) NOT NULL,
	"redirect_uris" text[] NOT NULL,
	"token_endpoint_auth_method" varchar(20) DEFAULT 'none' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authorization_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"code_digest" varchar(64) NOT NULL,
	"app_registration_id" uuid NOT NULL,
	"consent_id" uuid NOT NULL,
	"redirect_uri" varchar(2048) NOT NULL,
	"code_challenge" varchar(255) NOT NULL,
	"code_challenge_method" varchar(10) NOT NULL,
	"scope" varchar(255) NOT NULL,
	"resource" varchar(512) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "authorization_codes_code_digest_unique" UNIQUE("code_digest")
);
--> statement-breakpoint
CREATE TABLE "authorization_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"identifier_digest" varchar(64) NOT NULL,
	"app_registration_id" uuid NOT NULL,
	"redirect_uri" varchar(2048) NOT NULL,
	"code_challenge" varchar(255) NOT NULL,
	"code_challenge_method" varchar(10) NOT NULL,
	"scope" varchar(255) NOT NULL,
	"resource" varchar(512) NOT NULL,
	"state" varchar(512),
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "authorization_requests_identifier_digest_unique" UNIQUE("identifier_digest")
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"user_id" uuid NOT NULL,
	"app_registration_id" uuid NOT NULL,
	"scope" varchar(255) NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "issued_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"consent_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"access_token_digest" varchar(64) NOT NULL,
	"access_token_expires_at" timestamp with time zone NOT NULL,
	"refresh_token_digest" varchar(64) NOT NULL,
	"refresh_token_expires_at" timestamp with time zone NOT NULL,
	"resource" varchar(512) NOT NULL,
	"rotated_at" timestamp with time zone,
	"successor_id" uuid,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "issued_credentials_access_token_digest_unique" UNIQUE("access_token_digest"),
	CONSTRAINT "issued_credentials_refresh_token_digest_unique" UNIQUE("refresh_token_digest")
);
--> statement-breakpoint
ALTER TABLE "authorization_codes" ADD CONSTRAINT "authorization_codes_app_registration_id_app_registrations_id_fk" FOREIGN KEY ("app_registration_id") REFERENCES "public"."app_registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorization_codes" ADD CONSTRAINT "authorization_codes_consent_id_consents_id_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."consents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorization_requests" ADD CONSTRAINT "authorization_requests_app_registration_id_app_registrations_id_fk" FOREIGN KEY ("app_registration_id") REFERENCES "public"."app_registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_app_registration_id_app_registrations_id_fk" FOREIGN KEY ("app_registration_id") REFERENCES "public"."app_registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_credentials" ADD CONSTRAINT "issued_credentials_consent_id_consents_id_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."consents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_credentials" ADD CONSTRAINT "issued_credentials_successor_id_issued_credentials_id_fk" FOREIGN KEY ("successor_id") REFERENCES "public"."issued_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issued_credentials_family_id_idx" ON "issued_credentials" USING btree ("family_id");