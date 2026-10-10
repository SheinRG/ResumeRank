import { connection } from "next/server";

import { rateLimit, SSO_START_LIMIT } from "@resumerank/core/rate-limit";
import { clientIp } from "@resumerank/core/request-ip";
import { SSO_PRODUCT, ssoCallbackUrl, ssoControllers } from "@resumerank/core/sso/jackson";
import { ssoAuthorizeRequestSchema } from "@resumerank/core/validators/sso";
import {
  browserFailure,
  htmlPage,
  PayloadTooLargeError,
  queryParams,
  readForm,
  redirectTo,
} from "@/server/sso-routes";

/**
 * First hop of an SSO login: Auth.js sends the browser here with the tenant
 * to sign in to, and the SSO service forwards it to that company's identity
 * provider — by redirect, or by an auto-submitting form for SAML POST binding.
 */
async function authorize(request: Request, params: Record<string, string>): Promise<Response> {
  const limited = await rateLimit(`sso-start:${clientIp(request.headers)}`, SSO_START_LIMIT);
  if (!limited.allowed) {
    return redirectTo(new URL("/login?error=SsoFailed", request.url).toString());
  }

  const parsed = ssoAuthorizeRequestSchema.safeParse(params);
  if (
    !parsed.success ||
    parsed.data.product !== SSO_PRODUCT ||
    parsed.data.redirect_uri !== ssoCallbackUrl()
  ) {
    return browserFailure(request, "authorize", new Error("Malformed authorize request"));
  }

  try {
    const { oauthController } = await ssoControllers();
    const result = await oauthController.authorize(parsed.data);
    if (result.redirect_url) return redirectTo(result.redirect_url);
    if (result.authorize_form) return htmlPage(result.authorize_form);
    return browserFailure(request, "authorize", new Error(result.error ?? "No redirect from authorize"));
  } catch (error) {
    return browserFailure(request, "authorize", error);
  }
}

export async function GET(request: Request): Promise<Response> {
  await connection();
  return authorize(request, queryParams(request));
}

export async function POST(request: Request): Promise<Response> {
  try {
    return await authorize(request, await readForm(request));
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return new Response(null, { status: 413 });
    throw error;
  }
}
