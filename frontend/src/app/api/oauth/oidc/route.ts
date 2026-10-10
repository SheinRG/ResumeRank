import { connection } from "next/server";

import { ssoControllers } from "@resumerank/core/sso/jackson";
import { browserFailure, htmlPage, queryParams, redirectTo } from "@/server/sso-routes";

/** Where an OIDC identity provider returns the browser; the SSO service trades its code and hands off to Auth.js. */
export async function GET(request: Request): Promise<Response> {
  await connection();
  try {
    const { oauthController } = await ssoControllers();
    const result = await oauthController.oidcAuthzResponse(queryParams(request));
    if (result.redirect_url) return redirectTo(result.redirect_url);
    if (result.response_form) return htmlPage(result.response_form);
    return browserFailure(request, "oidc", new Error(result.error ?? "No redirect from OIDC callback"));
  } catch (error) {
    return browserFailure(request, "oidc", error);
  }
}
