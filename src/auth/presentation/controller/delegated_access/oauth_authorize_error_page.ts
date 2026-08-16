import { escapeHtml } from "../../../../core/infra/http/utils/escape_html";

/**
 * Mode A error page (E2): rendered whenever there is no verified redirect
 * target yet, so navigating anywhere — even back to the client — would
 * reopen the exact open redirect this mode exists to close. No `<a>`, no
 * button, no `Location` header, no meta refresh, no script: the page shows
 * the reason and goes nowhere.
 *
 * `reason` is always one of this route's own fixed, generic strings (E7 —
 * never the rejected input value itself, and E2's own preference to not
 * render the offending value at all). It's still escaped here as a second
 * line of defense, in case a future caller passes something less inert.
 */
export function renderAuthorizeErrorPage(reason: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Authorization error</title></head>
<body><p>${escapeHtml(reason)}</p></body>
</html>`;
}
