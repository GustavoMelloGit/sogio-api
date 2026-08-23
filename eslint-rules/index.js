import { handlerOnlyEventHandlers } from "./handler_only_event_handlers.js";
import { zodIntBounds } from "./zod_int_bounds.js";
import { zodStringMax } from "./zod_string_max.js";

export const sogioPlugin = {
  meta: { name: "sogio" },
  rules: {
    "handler-only-event-handlers": handlerOnlyEventHandlers,
    "zod-int-bounds": zodIntBounds,
    "zod-string-max": zodStringMax,
  },
};
