type MinimalCalendarEvent = {
  uid?: string;
  summary?: string;
};

const AIRBNB_UID_MARKER = "@airbnb.com";
const BOOKING_UID_MARKER = "@booking.com";
const VRBO_UID_MARKERS = ["@homeaway.com", "@vrbo.com"];

const UNAVAILABLE_SUMMARY_PHRASES = [
  "not available",
  "unavailable",
  "blocked",
  "closed",
  "busy",
];

export class ExternalCalendarEventPolicy {
  static isBooking(event: MinimalCalendarEvent): boolean {
    const uid = event.uid ?? "";

    if (uid.includes(AIRBNB_UID_MARKER)) {
      return event.summary === "Reserved";
    }

    if (uid.includes(BOOKING_UID_MARKER)) {
      return !this.#isUnavailableSummary(event.summary);
    }

    if (VRBO_UID_MARKERS.some(marker => uid.includes(marker))) {
      return !this.#isUnavailableSummary(event.summary);
    }

    return !this.#isUnavailableSummary(event.summary);
  }

  static #isUnavailableSummary(summary?: string): boolean {
    if (!summary) return false;
    const normalized = summary.toLowerCase();
    return UNAVAILABLE_SUMMARY_PHRASES.some(phrase =>
      normalized.includes(phrase)
    );
  }
}
