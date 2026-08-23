import z from "zod";
import type { UseCase } from "../../../core/application/use_case/use_case";
import type { User } from "../../../auth/domain/entity/user";
import type { EntitlementService } from "../../../billing/application/service/entitlement_service";
import type { Entitlement } from "../../../billing/domain/value_object/entitlement";
import type { PropertyRepository } from "../../domain/repository/property_repository";
import {
  Property,
  MAX_PROPERTY_CAPACITY,
  MAX_PROPERTY_IMAGES,
} from "../../domain/entity/property";
import { CapabilityLimitPolicy } from "../../../billing/domain/policy/capability_limit_policy";
import type {
  ImportRunner,
  ImportMode,
  ImportOutcome,
} from "../../../core/application/import/import_runner";
import type {
  ImportRecordStream,
  SourceRecord,
} from "../../../core/application/import/source_record";
import type { ImportFailure } from "../../../core/application/import/import_failure";

const propertyImportRecordSchema = z
  .object({
    name: z
      .string()
      .min(1, "Name is required")
      .max(100, "Name must be at most 100 characters"),
    capacity: z.coerce
      .number()
      .int("Capacity must be an integer")
      .positive("Capacity must be greater than 0")
      .max(
        MAX_PROPERTY_CAPACITY,
        `Capacity must be at most ${MAX_PROPERTY_CAPACITY}`
      ),
    street: z
      .string()
      .min(1, "Street is required")
      .max(100, "Street must be at most 100 characters"),
    number: z
      .string()
      .min(1, "Number is required")
      .max(20, "Number must be at most 20 characters"),
    neighborhood: z
      .string()
      .min(1, "Neighborhood is required")
      .max(100, "Neighborhood must be at most 100 characters"),
    city: z
      .string()
      .min(1, "City is required")
      .max(100, "City must be at most 100 characters"),
    state: z
      .string()
      .min(1, "State is required")
      .max(100, "State must be at most 100 characters"),
    zip_code: z
      .string()
      .min(1, "Zip code is required")
      .max(20, "Zip code must be at most 20 characters"),
    country: z
      .string()
      .min(1, "Country is required")
      .max(100, "Country must be at most 100 characters"),
    complement: z
      .string()
      .max(100, "Complement must be at most 100 characters")
      .optional()
      .default(""),
    images: z
      .string()
      .max(8192, "Images must be at most 8192 characters")
      .optional()
      .transform(value =>
        value
          ? value
              .split("|")
              .map(url => url.trim())
              .filter(url => url.length > 0)
          : []
      )
      .pipe(
        z
          .array(
            z.string().max(2048, "Image URL must be at most 2048 characters")
          )
          .max(MAX_PROPERTY_IMAGES, `At most ${MAX_PROPERTY_IMAGES} images`)
      ),
  })
  .transform(data => ({
    name: data.name,
    capacity: data.capacity,
    images: data.images,
    address: {
      street: data.street,
      number: data.number,
      neighborhood: data.neighborhood,
      city: data.city,
      state: data.state,
      zip_code: data.zip_code,
      country: data.country,
      complement: data.complement,
    },
  }));

function toImportFailure(row: number, error: z.ZodError): ImportFailure {
  const issue = error.issues[0];
  return {
    row,
    field: issue ? issue.path.join(".") || null : null,
    message: issue?.message ?? "Invalid record",
  };
}

export type ImportBatchPropertiesInput = {
  records: ImportRecordStream;
};

export class ImportBatchPropertiesUseCase
  implements UseCase<ImportBatchPropertiesInput, ImportOutcome>
{
  constructor(
    private readonly propertyRepository: PropertyRepository,
    private readonly entitlementService: EntitlementService,
    private readonly importRunner: ImportRunner
  ) {}

  async execute(
    input: ImportBatchPropertiesInput,
    user: User
  ): Promise<ImportOutcome> {
    const entitlement = await this.entitlementService.entitlementOf(user.id);

    return this.importRunner.run(input.records, (record, mode) =>
      this.#applyRecord(record, mode, user.id, entitlement)
    );
  }

  async #applyRecord(
    record: SourceRecord,
    mode: ImportMode,
    userId: string,
    entitlement: Entitlement
  ): Promise<ImportFailure | null> {
    const parsed = propertyImportRecordSchema.safeParse(record.values);

    if (!parsed.success) {
      return toImportFailure(record.row, parsed.error);
    }

    if (mode === "validate") {
      return null;
    }

    const property = Property.create({
      name: parsed.data.name,
      user_id: userId,
      address: parsed.data.address,
      images: parsed.data.images,
      capacity: parsed.data.capacity,
    });

    await this.propertyRepository.saveNewWithinQuota(property, currentCount =>
      CapabilityLimitPolicy.ensureWithinLimit(
        "max_properties",
        currentCount,
        entitlement.capabilities.limitOf("max_properties")
      )
    );

    return null;
  }
}
