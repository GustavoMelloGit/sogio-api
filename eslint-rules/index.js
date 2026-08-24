import { handlerOnlyEventHandlers } from "./handler_only_event_handlers.js";
import { serviceOnlyServiceObjects } from "./service_only_service_objects.js";
import { zodArrayMax } from "./zod_array_max.js";
import { zodFormatShorthand } from "./zod_format_shorthand.js";
import { zodIntBounds } from "./zod_int_bounds.js";
import { zodStringMax } from "./zod_string_max.js";

export const sogioPlugin = {
  meta: { name: "sogio" },
  rules: {
    "handler-only-event-handlers": handlerOnlyEventHandlers,
    "service-only-service-objects": serviceOnlyServiceObjects,
    "zod-array-max": zodArrayMax,
    "zod-format-shorthand": zodFormatShorthand,
    "zod-int-bounds": zodIntBounds,
    "zod-string-max": zodStringMax,
  },
};
