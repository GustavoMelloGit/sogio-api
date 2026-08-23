import { z } from "zod";
import { CalendarDate } from "../../../core/domain/calendar/calendar_date";
import type { UseCase } from "../../../core/application/use_case/use_case";
import type { User } from "../../../auth/domain/entity/user";
import type { EventDispatcher } from "../../../core/application/event/event_dispatcher";
import { ValidationError } from "../../../core/application/error/validation_error";
import { ConflictError } from "../../../core/application/error/conflict_error";
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
import { MAX_PROPERTY_CAPACITY } from "../../../property_management/domain/entity/property";
import { BookingProperty } from "../../domain/entity/booking_property";
import { MAX_STAY_PRICE_IN_CENTS } from "../../domain/entity/stay";
import { Tenant, tenantSexSchema } from "../../domain/entity/tenant";
import { StayImportedEvent } from "../../domain/event/stay_imported_event";
import type { BookingPolicy } from "../../domain/policy/booking_policy";
import type { BookingPropertyRepository } from "../../domain/repository/booking_property_repository";
import type { StayRepository } from "../../domain/repository/stay_repository";
import type { TenantRepository } from "../../domain/repository/tenant_repository";
import type { EntranceCodeGenerator } from "../../domain/service/entrance_code_generator";
import type { PropertyCheckTimesService } from "../../../property_management/application/service/property_check_times_service";
import type { PropertyCheckTimes } from "../../../property_management/domain/service/property_check_times";

function dateField(fieldLabel: string) {
  return z
    .string()
    .max(32, `${fieldLabel} must be at most 32 characters`)
    .transform((value, ctx) => {
      const date = CalendarDate.parse(value);

      if (!date) {
        ctx.addIssue({
          code: "custom",
          message: `${fieldLabel} must be a date in YYYY-MM-DD or DD/MM/YYYY format`,
        });
        return z.NEVER;
      }

      return date;
    });
}

const stayImportRecordSchema = z
  .object({
    property_id: z.uuid("property_id must be a valid UUID"),
    check_in: dateField("check_in"),
    check_out: dateField("check_out"),
    guests: z.coerce
      .number()
      .int("guests must be a positive integer")
      .positive("guests must be a positive integer")
      .max(
        MAX_PROPERTY_CAPACITY,
        `guests must be at most ${MAX_PROPERTY_CAPACITY}`
      ),
    price: z.coerce
      .number()
      .int("price must be an integer number of cents")
      .nonnegative("price must be a non-negative integer")
      .max(
        MAX_STAY_PRICE_IN_CENTS,
        `price must be at most ${MAX_STAY_PRICE_IN_CENTS} cents`
      ),
    source: z.string().min(1, "source is required").max(100),
    tenant_name: z
      .string()
      .min(3, "tenant_name must be at least 3 characters")
      .max(100, "tenant_name must be at most 100 characters"),
    tenant_phone: z
      .string()
      .regex(/^[0-9]+$/, "tenant_phone must contain only numbers")
      .min(10, "tenant_phone must be at least 10 digits")
      .max(15, "tenant_phone must be at most 15 digits"),
    tenant_sex: tenantSexSchema,
    entrance_code: z
      .string()
      .max(10, "entrance_code must be at most 10 characters long")
      .optional()
      .transform(value => (value && value.length > 0 ? value : undefined)),
  })
  .refine(data => data.check_in.isBefore(data.check_out), {
    message: "check_in must be before check_out",
    path: ["check_in"],
  });

function toImportFailure(row: number, error: z.ZodError): ImportFailure {
  const issue = error.issues[0];
  return {
    row,
    field: issue ? issue.path.join(".") || null : null,
    message: issue?.message ?? "Invalid record",
  };
}

export type ImportBatchStaysInput = {
  records: ImportRecordStream;
};

export class ImportBatchStaysUseCase
  implements UseCase<ImportBatchStaysInput, ImportOutcome>
{
  constructor(
    private readonly tenantRepository: TenantRepository,
    private readonly propertyRepository: BookingPropertyRepository,
    private readonly stayRepository: StayRepository,
    private readonly bookingPolicy: BookingPolicy,
    private readonly eventDispatcher: EventDispatcher,
    private readonly entranceCodeGenerator: EntranceCodeGenerator,
    private readonly importRunner: ImportRunner,
    private readonly propertyCheckTimesService: PropertyCheckTimesService
  ) {}

  async execute(
    input: ImportBatchStaysInput,
    user: User
  ): Promise<ImportOutcome> {
    const propertyCache = new Map<string, BookingProperty | null>();
    const checkTimesCache = new Map<string, PropertyCheckTimes>();

    return this.importRunner.run(input.records, (record, mode) =>
      this.#applyRecord(record, mode, user, propertyCache, checkTimesCache)
    );
  }

  async #applyRecord(
    record: SourceRecord,
    mode: ImportMode,
    user: User,
    propertyCache: Map<string, BookingProperty | null>,
    checkTimesCache: Map<string, PropertyCheckTimes>
  ): Promise<ImportFailure | null> {
    const parsed = stayImportRecordSchema.safeParse(record.values);

    if (!parsed.success) {
      return toImportFailure(record.row, parsed.error);
    }

    const data = parsed.data;

    let property = propertyCache.get(data.property_id);

    if (property === undefined) {
      property = await this.propertyRepository.propertyOfId(data.property_id);
      propertyCache.set(data.property_id, property);
    }

    if (!property || property.user_id !== user.id) {
      return {
        row: record.row,
        field: "property_id",
        message: "Property not found",
      };
    }

    const checkTimes = await this.#checkTimesOf(property.id, checkTimesCache);
    const check_in = data.check_in.atWallClock(
      checkTimes.check_in,
      user.time_zone
    );
    const check_out = data.check_out.atWallClock(
      checkTimes.check_out,
      user.time_zone
    );

    try {
      let tenant = await this.tenantRepository.findByPhoneForOwner(
        user.id,
        data.tenant_phone
      );

      if (!tenant && mode === "write") {
        tenant = await this.tenantRepository.save(
          Tenant.create({
            owner_id: user.id,
            name: data.tenant_name,
            phone: data.tenant_phone,
            sex: data.tenant_sex,
          })
        );
      }

      const stay = await property.bookStay(
        {
          guests: data.guests,
          tenant_id: tenant?.id ?? crypto.randomUUID(),
          entrance_code:
            data.entrance_code ?? this.entranceCodeGenerator.generate(),
          check_in,
          check_out,
          price: data.price,
          source: data.source,
        },
        this.bookingPolicy
      );

      if (mode === "validate") {
        return null;
      }

      await this.stayRepository.saveStay(stay);

      const event = new StayImportedEvent(
        stay.id,
        tenant?.name ?? data.tenant_name,
        property.id,
        stay.price,
        stay.check_in,
        stay.check_out
      );
      await this.eventDispatcher.dispatch(event);

      return null;
    } catch (error) {
      if (error instanceof ValidationError || error instanceof ConflictError) {
        return { row: record.row, field: null, message: error.message };
      }
      throw error;
    }
  }

  async #checkTimesOf(
    property_id: string,
    checkTimesCache: Map<string, PropertyCheckTimes>
  ): Promise<PropertyCheckTimes> {
    const cached = checkTimesCache.get(property_id);

    if (cached) return cached;

    const checkTimes =
      await this.propertyCheckTimesService.checkTimesOf(property_id);
    checkTimesCache.set(property_id, checkTimes);

    return checkTimes;
  }
}
