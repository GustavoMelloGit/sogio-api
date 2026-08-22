export type OpenApiParameter = {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  description?: string;
  required?: boolean;
  schema: Record<string, unknown>;
};

export type OpenApiRequestBody = {
  description?: string;
  required?: boolean;
  content: {
    "application/json": {
      schema: Record<string, unknown>;
      example?: Record<string, unknown>;
    };
  };
};

export type OpenApiResponse = {
  description: string;
  content?: {
    "application/json": {
      schema: Record<string, unknown>;
      example?: unknown;
    };
  };
};

export type OpenApiOperation = {
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses: Record<string, OpenApiResponse>;
};
