import { JoinWaitlistUseCase } from "../../application/use_case/join_waitlist";
import type { WaitlistLeadRepository } from "../../domain/repository/waitlist_lead_repository";
import { JoinWaitlistController } from "../../presentation/controller/join_waitlist.controller";
import { WaitlistLeadPostgresRepository } from "../database/postgres_repository/waitlist_lead_postgres_repository";

export class MarketingDi {
  #waitlistLeadRepository: WaitlistLeadRepository;

  constructor() {
    this.#waitlistLeadRepository = new WaitlistLeadPostgresRepository();
  }

  makeJoinWaitlistUseCase() {
    return new JoinWaitlistUseCase(this.#waitlistLeadRepository);
  }

  makeJoinWaitlistController() {
    return new JoinWaitlistController(this.makeJoinWaitlistUseCase());
  }
}
