import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import type { User } from "../../../auth/domain/entity/user";
import type { CapabilityKey } from "../../../billing/domain/capability/capability_key";

export type McpToolInput<Shape extends z.ZodRawShape> = {
  [Key in keyof Shape]: z.infer<Shape[Key]>;
};

export type McpToolDefinition<Shape extends z.ZodRawShape = z.ZodRawShape> = {
  name: string;
  description: string;
  inputSchema: Shape;
  annotations?: ToolAnnotations;
  requiredCapability?: CapabilityKey;
  /**
   * Declared with method shorthand (bivariant parameter checking) on purpose:
   * it lets `registerMcpTool` accept any `McpToolDefinition<Shape>` through a
   * single non-generic parameter typed `McpToolDefinition<z.ZodRawShape>`,
   * which is what keeps the Zod SDK's own generic `registerTool` inference
   * well-behaved (passing a still-generic Shape through it collapses to its
   * index-signature constraint). Type safety at each tool's authoring site
   * is unaffected, since `Shape` is concrete there.
   */
  handler(input: McpToolInput<Shape>, user: User): Promise<unknown>;
};
