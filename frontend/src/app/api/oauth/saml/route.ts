import { ssoControllers } from "@resumerank/core/sso/jackson";
import {
  browserFailure,
  htmlPage,
  PayloadTooLargeError,
  readForm,
  redirectTo,
} from "@/server/sso-routes";

/**
 * The assertion consumer service: the identity provider posts its signed
 * SAML response here (a cross-site form post, so no session cookie is
 * expected). The SSO service validates it against the company's certificate
 * and hands the browser on to Auth.js with a one-time code.
 */
export async function POST(request: Request): Promise<Response> {
  let form: Record<string, string>;
  try {
    form = await readForm(request);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return new Response(null, { status: 413 });
    throw error;
  }

  const samlResponse = form.SAMLResponse;
  if (!samlResponse) return browserFailure(request, "saml", new Error("Missing SAMLResponse"));

  try {
    const { oauthController } = await ssoControllers();
    const result = await oauthController.samlResponse({
      SAMLResponse: samlResponse,
      RelayState: form.RelayState ?? "",
    });
    if (result.redirect_url) return redirectTo(result.redirect_url);
    if (result.response_form) return htmlPage(result.response_form);
    return browserFailure(request, "saml", new Error(result.error ?? "No redirect from ACS"));
  } catch (error) {
    return browserFailure(request, "saml", error);
  }
}
