import { AppRegistration } from "../../domain/entity/delegated_access/app_registration";
import type { AppRegistrationRepository } from "../../domain/repository/delegated_access/app_registration_repository";
import type { UseCase } from "../../../core/application/use_case/use_case";
import type { Logger } from "../../../core/application/logger/logger";

type Input = {
  client_name: string;
  redirect_uris: string[];
};

type Output = {
  id: string;
  client_name: string;
  redirect_uris: string[];
  token_endpoint_auth_method: "none";
  created_at: Date;
};

/**
 * A registration with no consent after this long has no reason to keep
 * existing (E9). Chosen to comfortably outlast the time between a
 * legitimate client registering and completing its first authorization,
 * which in the DCR flow happens within the same session.
 */
const UNUSED_REGISTRATION_PURGE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Dynamic client registration (RFC 7591). The caller (the controller) has
 * already validated the content against E3/E6 — this use case only
 * persists the entity.
 *
 * The project has no scheduler/cron infrastructure, so the expurgation of
 * unused registrations (E9) isn't a separate job: it piggybacks on
 * `/register`'s own traffic, best-effort, right after a successful
 * registration. A failure here never fails the registration itself.
 */
export class RegisterAppUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly appRegistrationRepository: AppRegistrationRepository,
    private readonly logger: Logger
  ) {}

  async execute(input: Input): Promise<Output> {
    const appRegistration = AppRegistration.create({
      client_name: input.client_name,
      redirect_uris: input.redirect_uris,
      token_endpoint_auth_method: "none",
    });

    const saved = await this.appRegistrationRepository.create(appRegistration);

    await this.#purgeUnusedRegistrations();

    return {
      id: saved.id,
      client_name: saved.client_name,
      redirect_uris: [...saved.redirect_uris],
      token_endpoint_auth_method: saved.token_endpoint_auth_method,
      created_at: saved.created_at,
    };
  }

  async #purgeUnusedRegistrations(): Promise<void> {
    const threshold = new Date(
      Date.now() - UNUSED_REGISTRATION_PURGE_THRESHOLD_MS
    );

    try {
      await this.appRegistrationRepository.deleteUnusedRegisteredBefore(
        threshold
      );
    } catch {
      this.logger.error("Failed to purge unused app registrations", {
        endpoint: "register_app",
      });
    }
  }
}
