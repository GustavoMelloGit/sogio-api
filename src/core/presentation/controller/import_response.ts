import { ImportRejectedError } from "../../application/import/import_failure";
import { ControllerHttpResponse } from "./controller";

export function importRejectedResponse(error: unknown): ControllerHttpResponse {
  if (!(error instanceof ImportRejectedError)) {
    throw error;
  }

  return new ControllerHttpResponse({
    status: 422,
    body: {
      message: error.message,
      failures: error.report.failures,
      truncated: error.report.truncated,
    },
  });
}
