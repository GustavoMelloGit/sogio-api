import { env, frontBaseUrl } from "../../../core/infra/config/environments";

export class CorsMiddleware {
  private readonly allowedOrigins: string[];
  private readonly allowedMethods: string[];
  private readonly allowedHeaders: string[];

  constructor() {
    const isProduction = env.NODE_ENV === "production";
    if (isProduction) {
      /**
       * Exactly the front's origin (E8) — not a `https://*` wildcard. The
       * previous wildcard accepted any HTTPS origin, which combined with
       * `Access-Control-Allow-Credentials: true` below is effectively `*`
       * with credentials enabled. `stayhub-front` is the API's one
       * legitimate browser caller (the app itself and the OAuth consent
       * screen both live there), so this is a like-for-like tightening, not
       * a behavior change for real traffic.
       */
      this.allowedOrigins = [frontBaseUrl];
    } else {
      this.allowedOrigins = ["http://localhost:*"];
    }

    this.allowedMethods = ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"];
    this.allowedHeaders = [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Origin",
    ];
  }

  handlePreflightRequest(request: Request, corsPolicy?: "public"): Response {
    if (corsPolicy === "public") {
      return new Response(null, {
        status: 200,
        headers: this.getPublicCorsHeaders(),
      });
    }

    const origin = request.headers.get("Origin");

    if (!this.isOriginAllowed(origin)) {
      return new Response("CORS: Origin not allowed", { status: 403 });
    }

    return new Response(null, {
      status: 200,
      headers: this.getCorsHeaders(origin),
    });
  }
  addCorsHeaders(
    response: Response,
    origin: string | null,
    corsPolicy?: "public"
  ): Response {
    if (corsPolicy === "public") {
      const headers = new Headers(response.headers);
      const publicCorsHeaders = this.getPublicCorsHeaders();
      for (const [key, value] of publicCorsHeaders.entries()) {
        headers.set(key, value);
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    if (!this.isOriginAllowed(origin)) {
      return response;
    }

    const headers = new Headers(response.headers);

    // Add CORS headers
    const corsHeaders = this.getCorsHeaders(origin);
    for (const [key, value] of corsHeaders.entries()) {
      headers.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  private getCorsHeaders(origin: string | null): Headers {
    const headers = new Headers();

    if (origin && this.isOriginAllowed(origin)) {
      headers.set("Access-Control-Allow-Origin", origin);
    }

    headers.set("Access-Control-Allow-Methods", this.allowedMethods.join(", "));
    headers.set("Access-Control-Allow-Headers", this.allowedHeaders.join(", "));
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Max-Age", "86400"); // 24 hours

    return headers;
  }

  /**
   * Headers for the deliberate public-CORS exception (E8 in the MCP OAuth
   * authorization plan): the two discovery documents respond to any origin,
   * with no `Access-Control-Allow-Credentials` — they carry no session and
   * no secret, so there is nothing a credentialed request would protect.
   */
  private getPublicCorsHeaders(): Headers {
    const headers = new Headers();

    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Accept");
    headers.set("Access-Control-Max-Age", "86400"); // 24 hours

    return headers;
  }

  private isOriginAllowed(origin: string | null): boolean {
    if (!origin) {
      return false;
    }

    return this.allowedOrigins.some(allowedOrigin => {
      /**
       * A trailing `*` (only used for the "any localhost port" dev
       * allowance) is a genuine prefix match. Anything else — in
       * particular `frontBaseUrl` in production (E8) — has to match the
       * origin exactly; a `startsWith` here would let
       * `https://front.stayhub.com.evil.com` through against an allowed
       * origin of `https://front.stayhub.com`.
       */
      if (allowedOrigin.endsWith("*")) {
        return origin.startsWith(allowedOrigin.slice(0, -1));
      }

      return origin === allowedOrigin;
    });
  }
}
