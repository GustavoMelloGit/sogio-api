import { z } from "zod";
import {
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../../core/presentation/controller/controller";
import type { OpenApiOperation } from "../../../../core/presentation/open_api/open_api_types";
import {
  errorResponse,
  responseFromZod,
} from "../../../../core/infra/http/swagger/schema_helpers";
import type { User } from "../../../domain/entity/user";
import type { ListConnectedAppsUseCase } from "../../../application/use_case/list_connected_apps";

const outputSchema = z.array(
  z.object({
    consent_id: z.string().uuid(),
    app_display_name: z.string(),
    app_display_name_verified: z.literal(false),
    redirect_host: z.string(),
    granted_at: z.string().datetime(),
    last_used_at: z.string().datetime(),
  })
);

/**
 * `GET /auth/connected-apps` — tela de "aplicativos conectados" (task 14,
 * contrato com o stayhub-front). Autenticado pela sessão normal do app
 * (`authenticated: true` na rota, JWT Bearer), nunca pela credencial OAuth
 * (Decisão Arquitetural 12) — um aplicativo conectado não pode se
 * auto-gerenciar nem enxergar os demais, o que fecharia o ciclo de
 * privilégio que a revogação existe para quebrar.
 *
 * O escopo por usuário vem inteiramente de `user`, resolvido pelo
 * middleware a partir do token apresentado — não há parâmetro de rota, de
 * query, ou de corpo que o substitua, então não há caminho para pedir a
 * lista de outro usuário por id.
 */
export class ListConnectedAppsController implements Controller {
  path = "/auth/connected-apps";
  method = HttpControllerMethod.GET;

  openApiSpec: OpenApiOperation = {
    summary: "List connected apps",
    description:
      "Lists the authenticated user's connected MCP apps: one entry per unrevoked Consent, with the app's self-declared (unverified) name, its registered redirect host, and when it was granted/last used.",
    tags: ["Auth"],
    responses: {
      "200": responseFromZod("List of connected apps", outputSchema),
      "401": errorResponse("Unauthorized"),
    },
  };

  constructor(private readonly useCase: ListConnectedAppsUseCase) {}

  async handle(_request: ControllerRequest, user: User) {
    const apps = await this.useCase.execute(undefined, user);

    return apps.map(app => ({
      consent_id: app.consentId,
      app_display_name: app.appDisplayName,
      app_display_name_verified: app.appDisplayNameVerified,
      redirect_host: app.redirectHost,
      granted_at: app.grantedAt,
      last_used_at: app.lastUsedAt,
    }));
  }
}
