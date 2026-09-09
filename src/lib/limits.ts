/**
 * Limits both the browser and the server need to agree on.
 *
 * These live apart from the modules that enforce them because the enforcing
 * modules reach for node:crypto, and importing one of those into a client
 * component drags Node into the browser bundle. A duplicated constant that
 * drifts would show up as an unexplained 400, so there is exactly one.
 */

/**
 * Addresses per geocode request.
 *
 * Small on purpose. Nominatim allows one lookup per second, so ten addresses
 * is ten seconds — about as long as a request should ever be held open. The
 * client sends several small batches instead of one long one so the map fills
 * in as it goes rather than looking frozen.
 */
export const MAX_QUERIES_PER_REQUEST = 10;
