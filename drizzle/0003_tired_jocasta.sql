-- Achado 1 (revisão pós-implementação): Consentimento é a relação
-- (usuário, aplicativo) no singular, mas nada impedia múltiplas linhas para
-- a mesma combinação até agora. Antes de criar o índice único abaixo,
-- consolida duplicatas existentes num único sobrevivente por
-- (user_id, app_registration_id): não revogado vence revogado; entre
-- empates, o mais recentemente concedido vence. Créditos e códigos de
-- autorização das linhas descartadas são reapontados para o sobrevivente
-- em vez de perdidos ao cascade-delete, para que o histórico de
-- credenciais emitidas sob aquele (usuário, aplicativo) não desapareça.
CREATE TEMP TABLE "consent_survivors" AS
SELECT DISTINCT ON ("user_id", "app_registration_id")
  "id" AS "survivor_id", "user_id", "app_registration_id"
FROM "consents"
ORDER BY "user_id", "app_registration_id", ("revoked_at" IS NULL) DESC, "granted_at" DESC, "created_at" DESC, "id";
--> statement-breakpoint
UPDATE "issued_credentials" AS "ic"
SET "consent_id" = "cs"."survivor_id"
FROM "consents" AS "c"
JOIN "consent_survivors" AS "cs"
  ON "cs"."user_id" = "c"."user_id" AND "cs"."app_registration_id" = "c"."app_registration_id"
WHERE "ic"."consent_id" = "c"."id"
  AND "ic"."consent_id" <> "cs"."survivor_id";
--> statement-breakpoint
UPDATE "authorization_codes" AS "ac"
SET "consent_id" = "cs"."survivor_id"
FROM "consents" AS "c"
JOIN "consent_survivors" AS "cs"
  ON "cs"."user_id" = "c"."user_id" AND "cs"."app_registration_id" = "c"."app_registration_id"
WHERE "ac"."consent_id" = "c"."id"
  AND "ac"."consent_id" <> "cs"."survivor_id";
--> statement-breakpoint
DELETE FROM "consents" AS "c"
USING "consent_survivors" AS "cs"
WHERE "c"."user_id" = "cs"."user_id"
  AND "c"."app_registration_id" = "cs"."app_registration_id"
  AND "c"."id" <> "cs"."survivor_id";
--> statement-breakpoint
DROP TABLE "consent_survivors";
--> statement-breakpoint
CREATE UNIQUE INDEX "consents_user_id_app_registration_id_idx" ON "consents" USING btree ("user_id","app_registration_id");