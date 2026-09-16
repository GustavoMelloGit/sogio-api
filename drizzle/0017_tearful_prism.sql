ALTER TABLE "stays" ALTER COLUMN "source" SET DEFAULT 'DIRECT';--> statement-breakpoint
UPDATE "stays" SET "source" = 'DIRECT' WHERE "source" = 'INTERNAL';
