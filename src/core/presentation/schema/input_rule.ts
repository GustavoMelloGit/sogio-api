import { z } from "zod";
import { ValidationError } from "../../application/error/validation_error";

export type InputRule<Input> = {
  message: string;
  path: string[];
  isSatisfiedBy(input: Input): boolean;
};

export function withRules<Schema extends z.ZodTypeAny>(
  schema: Schema,
  ...rules: InputRule<z.infer<Schema>>[]
): Schema {
  return rules.reduce(
    (refined, rule) =>
      refined.refine(input => rule.isSatisfiedBy(input), {
        message: rule.message,
        path: rule.path,
      }),
    schema
  );
}

export function assertRules<Input>(
  input: Input,
  ...rules: InputRule<Input>[]
): void {
  for (const rule of rules) {
    if (!rule.isSatisfiedBy(input)) {
      throw new ValidationError(
        rule.path.length > 0
          ? `${rule.path.join(".")}: ${rule.message}`
          : rule.message
      );
    }
  }
}
