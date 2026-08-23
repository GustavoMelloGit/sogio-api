import z from "zod";
import type { UseCase } from "../../../core/application/use_case/use_case";
import type { User } from "../../../auth/domain/entity/user";
import { ResourceNotFoundError } from "../../../core/application/error/resource_not_found_error";
import type { Property } from "../../../property_management/domain/entity/property";
import type { PropertyRepository } from "../../../property_management/domain/repository/property_repository";
import { PropertyOwnershipPolicy } from "../../../property_management/domain/policy/property_ownership_policy";
import {
  expenseCategorySchema,
  LedgerEntry,
  MAX_LEDGER_AMOUNT_IN_CENTS,
} from "../../domain/entity/ledger_entry";
import type { LedgerEntryRepository } from "../../domain/repository/ledger_entry_repository";
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
import { CalendarDate } from "../../../core/domain/calendar/calendar_date";
import { WallClockTime } from "../../../core/domain/calendar/wall_clock_time";

const ledgerEntryImportRecordSchema = z
  .object({
    property_id: z.uuidv4("property_id must be a valid UUID"),
    kind: z.enum(
      ["expense", "revenue"],
      "kind must be one of: expense, revenue"
    ),
    amount: z.coerce
      .number()
      .int("Amount must be an integer")
      .positive("Amount must be a positive integer of cents")
      .max(
        MAX_LEDGER_AMOUNT_IN_CENTS,
        `Amount must be at most ${MAX_LEDGER_AMOUNT_IN_CENTS} cents`
      ),
    category: z
      .string()
      .min(1, "Category is required")
      .max(100, "Category must be at most 100 characters"),
    description: z
      .string()
      .max(500, "Description must be at most 500 characters")
      .optional()
      .transform(value => (value && value.length > 0 ? value : null)),
    occurred_at: z
      .string()
      .max(10, "occurred_at must be at most 10 characters")
      .optional()
      .transform((value, ctx) => {
        if (!value || value.trim().length === 0) return undefined;

        const parsed = CalendarDate.parse(value);
        if (!parsed) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "occurred_at must be a valid date (YYYY-MM-DD or DD/MM/YYYY)",
          });
          return z.NEVER;
        }

        return parsed;
      }),
  })
  .superRefine((data, ctx) => {
    if (data.kind !== "expense") return;

    const result = expenseCategorySchema.safeParse(data.category);
    if (!result.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["category"],
        message: `Category must be one of: ${expenseCategorySchema.options.join(", ")}`,
      });
    }
  });

function toImportFailure(row: number, error: z.ZodError): ImportFailure {
  const issue = error.issues[0];
  return {
    row,
    field: issue ? issue.path.join(".") || null : null,
    message: issue?.message ?? "Invalid record",
  };
}

export type ImportBatchLedgerEntriesInput = {
  records: ImportRecordStream;
};

export class ImportBatchLedgerEntriesUseCase
  implements UseCase<ImportBatchLedgerEntriesInput, ImportOutcome>
{
  constructor(
    private readonly ledgerEntryRepository: LedgerEntryRepository,
    private readonly propertyRepository: PropertyRepository,
    private readonly importRunner: ImportRunner
  ) {}

  async execute(
    input: ImportBatchLedgerEntriesInput,
    user: User
  ): Promise<ImportOutcome> {
    const propertyCache = new Map<string, Property | null>();

    return this.importRunner.run(input.records, (record, mode) =>
      this.#applyRecord(record, mode, user, propertyCache)
    );
  }

  async #applyRecord(
    record: SourceRecord,
    mode: ImportMode,
    user: User,
    propertyCache: Map<string, Property | null>
  ): Promise<ImportFailure | null> {
    const parsed = ledgerEntryImportRecordSchema.safeParse(record.values);

    if (!parsed.success) {
      return toImportFailure(record.row, parsed.error);
    }

    if (mode === "validate") {
      return null;
    }

    let property = propertyCache.get(parsed.data.property_id);
    if (property === undefined) {
      property = await this.propertyRepository.propertyOfId(
        parsed.data.property_id
      );
      propertyCache.set(parsed.data.property_id, property);
    }

    try {
      PropertyOwnershipPolicy.ensureOwnership(property, user);
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        return {
          row: record.row,
          field: "property_id",
          message: "Property not found",
        };
      }
      throw error;
    }

    const amount =
      parsed.data.kind === "expense" ? -parsed.data.amount : parsed.data.amount;

    const entryData = {
      amount,
      description: parsed.data.description,
      category: parsed.data.category,
      property_id: parsed.data.property_id,
    };

    const occurred_at = parsed.data.occurred_at?.atWallClock(
      WallClockTime.MIDNIGHT,
      user.time_zone
    );

    const entry =
      parsed.data.kind === "expense"
        ? LedgerEntry.newExpense(entryData, occurred_at)
        : LedgerEntry.newRevenue(entryData, occurred_at);

    await this.ledgerEntryRepository.save(entry);

    return null;
  }
}
