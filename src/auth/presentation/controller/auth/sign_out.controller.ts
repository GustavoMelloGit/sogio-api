import type { SignOutUseCase } from "../../../application/use_case/sign_out";
import {
  ControllerHttpResponse,
  HttpControllerMethod,
  type Controller,
  type ControllerRequest,
} from "../../../../core/presentation/controller/controller";
import type { OpenApiOperation } from "../../../../core/presentation/open_api/open_api_types";
import {
  errorResponse,
  noContentResponse,
} from "../../../../core/infra/http/swagger/schema_helpers";
import {
  buildClearedSessionCookie,
  readSessionSecret,
} from "../../http/session_cookie";

export class SignOutController implements Controller {
  path = "/auth/sign-out";
  method = HttpControllerMethod.POST;

  openApiSpec: OpenApiOperation = {
    summary: "Sign out",
    description:
      "Ends the session that made the request and clears the session cookie.",
    tags: ["Auth"],
    responses: {
      "204": noContentResponse("Session ended"),
      "401": errorResponse("Unauthenticated"),
    },
  };

  constructor(private readonly useCase: SignOutUseCase) {}

  async handle(request: ControllerRequest) {
    const secret = readSessionSecret(request);

    if (secret) {
      await this.useCase.execute({ secret });
    }

    return new ControllerHttpResponse({
      status: 204,
      headers: { "Set-Cookie": buildClearedSessionCookie() },
      cache: "no-store",
    });
  }
}
