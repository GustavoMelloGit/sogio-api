import { z } from "zod";
import { ValidationError } from "../../../core/application/error/validation_error";
import type { UseCase } from "../../../core/application/use_case/use_case";
import {
  DEFAULT_WAITLIST_SOURCE,
  WaitlistLead,
  type PropertyCountRange,
} from "../../domain/entity/waitlist_lead";
import type { WaitlistLeadRepository } from "../../domain/repository/waitlist_lead_repository";

type Input = {
  name: string;
  whatsapp: string;
  property_count: PropertyCountRange;
  source?: string;
};

type Output = {
  id: string;
};

function toValidationMessage(error: z.ZodError): string {
  const issue = error.issues[0];

  if (!issue) {
    return "Invalid waitlist lead";
  }

  const path = issue.path.join(".");

  return path ? `${path}: ${issue.message}` : issue.message;
}

export class JoinWaitlistUseCase implements UseCase<Input, Output> {
  constructor(
    private readonly waitlistLeadRepository: WaitlistLeadRepository
  ) {}

  async execute(input: Input): Promise<Output> {
    const lead = this.#buildLead(input);
    const id = await this.waitlistLeadRepository.joinWaitlist(lead);

    return { id };
  }

  #buildLead(input: Input): WaitlistLead {
    try {
      return WaitlistLead.create({
        name: input.name,
        whatsapp: input.whatsapp,
        property_count: input.property_count,
        source: input.source ?? DEFAULT_WAITLIST_SOURCE,
        consented_at: new Date(),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError(toValidationMessage(error));
      }

      throw error;
    }
  }
}
