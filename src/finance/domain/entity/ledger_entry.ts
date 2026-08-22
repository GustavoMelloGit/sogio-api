import { z } from "zod";
import {
  baseEntitySchema,
  type WithoutBaseEntity,
} from "../../../core/domain/entity/base_entity";
import { ValidationError } from "../../../core/application/error/validation_error";

export const expenseCategorySchema = z.enum([
  "MANUTENÇÃO",
  "ESTADIA",
  "AQUISIÇÕES",
  "FINANCIAMENTO",
  "GASTOS_FIXOS",
  "OUTROS",
]);

export type ExpenseCategory = z.infer<typeof expenseCategorySchema>;

export const MAX_LEDGER_AMOUNT_IN_CENTS = 100_000_000;

export const ledgerEntrySchema = baseEntitySchema.extend({
  amount: z
    .int()
    .min(-MAX_LEDGER_AMOUNT_IN_CENTS)
    .max(MAX_LEDGER_AMOUNT_IN_CENTS),
  description: z.string().max(500).nullable(),
  category: z.string().max(100),
  property_id: z.uuidv4(),
});

export type LedgerEntryData = z.infer<typeof ledgerEntrySchema>;

/**
 * @kind Entity, Aggregate Root
 */
export class LedgerEntry {
  readonly #data: LedgerEntryData;

  private constructor(data: LedgerEntryData) {
    this.#data = ledgerEntrySchema.parse(data);
  }

  static #nextId(): string {
    return crypto.randomUUID();
  }

  static #baseEntityData() {
    return {
      id: this.#nextId(),
      created_at: new Date(),
      updated_at: new Date(),
    };
  }

  public static reconstitute(data: LedgerEntryData): LedgerEntry {
    return new LedgerEntry(data);
  }

  public static newExpense(
    data: WithoutBaseEntity<LedgerEntryData>
  ): LedgerEntry {
    if (data.amount >= 0) {
      throw new ValidationError("Amount must be less than 0");
    }

    const category = expenseCategorySchema.safeParse(data.category);

    if (!category.success) {
      throw new ValidationError(
        `Category must be one of: ${expenseCategorySchema.options.join(", ")}`
      );
    }

    return new LedgerEntry({
      ...data,
      ...this.#baseEntityData(),
    });
  }

  public static newRevenue(
    data: WithoutBaseEntity<LedgerEntryData>
  ): LedgerEntry {
    if (data.amount <= 0) {
      throw new ValidationError("Amount must be greater than 0");
    }

    return new LedgerEntry({
      ...data,
      ...this.#baseEntityData(),
    });
  }

  get id() {
    return this.#data.id;
  }

  get amount() {
    return this.#data.amount;
  }

  get description() {
    return this.#data.description;
  }

  get category() {
    return this.#data.category;
  }

  get property_id() {
    return this.#data.property_id;
  }

  get created_at() {
    return this.#data.created_at;
  }

  get updated_at() {
    return this.#data.updated_at;
  }

  get deleted_at() {
    return this.#data.deleted_at;
  }
}
