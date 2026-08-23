import { handlerOnlyEventHandlers } from "./handler_only_event_handlers.js";
import { serviceOnlyServiceObjects } from "./service_only_service_objects.js";
import { zodIntBounds } from "./zod_int_bounds.js";
import { zodStringMax } from "./zod_string_max.js";

export const sogioPlugin = {
  meta: { name: "sogio" },
  rules: {
    "handler-only-event-handlers": handlerOnlyEventHandlers,
    "service-only-service-objects": serviceOnlyServiceObjects,
    "zod-int-bounds": zodIntBounds,
    "zod-string-max": zodStringMax,
  },
};
