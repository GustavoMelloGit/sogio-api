CREATE TABLE "waitlist_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"name" varchar(255) NOT NULL,
	"whatsapp" varchar(15) NOT NULL,
	"property_count" varchar(10) NOT NULL,
	"source" varchar(50) NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	CONSTRAINT "waitlist_leads_whatsapp_unique" UNIQUE("whatsapp")
);
