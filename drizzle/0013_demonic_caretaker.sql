ALTER TABLE "tenants" DROP CONSTRAINT "tenants_phone_unique";--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
UPDATE "tenants" SET "owner_id" = (
	SELECT "p"."user_id"
	FROM "stays" "s"
	INNER JOIN "properties" "p" ON "p"."id" = "s"."property_id"
	WHERE "s"."tenant_id" = "tenants"."id"
	ORDER BY "s"."created_at" ASC
	LIMIT 1
) WHERE "owner_id" IS NULL;--> statement-breakpoint
DELETE FROM "tenants" WHERE "owner_id" IS NULL;--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "owner_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_owner_id_phone_idx" ON "tenants" USING btree ("owner_id","phone");
