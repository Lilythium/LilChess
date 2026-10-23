// The API contract this server offers to mobile clients. The policy and the rules for changing these two numbers are in
// docs/mobile-compatibility.md. Both are reported by GET /api/health.

/**
 * Bumped only by a breaking change: removing or renaming an endpoint, field or event, or changing what one means.
 * Additive changes (new endpoints, optional fields, new event types, new `features` entries) never bump it.
 */
export const SERVER_API_VERSION = 1;

/**
 * The oldest app API level this server still serves. An app reports the newest `apiVersion` it understands
 * (`MAX_API_VERSION` in mobile/src/serverSelection.ts); it works with this server when that number is at least this one.
 * Raise it only when the server really drops support for an older contract, and say so in docs/mobile-compatibility.md.
 * Must never exceed SERVER_API_VERSION.
 */
export const MIN_CLIENT_API_VERSION = 1;
