import { ssoControllers } from "@resumerank/core/sso/jackson";
import { ssoTokenRequestSchema } from "@resumerank/core/validators/sso";
import { json, jsonFailure, jsonRejection, PayloadTooLargeError, readForm } from "@/server/sso-routes";

/** Auth.js (server-to-server) trades the one-time code plus its PKCE verifier for an access token. */
export async function POST(request: Request): Promise<Response> {
  let form: Record<string, string>;
  try {
    form = await readForm(request);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return new Response(null, { status: 413 });
    throw error;
  }

  const parsed = ssoTokenRequestSchema.safeParse(form);
  if (!parsed.success) return jsonRejection("token", 400, "malformed token request");

  try {
    const { oauthController } = await ssoControllers();
    return json(await oauthController.token(parsed.data, request.headers.get("authorization")));
  } catch (error) {
    return jsonFailure("token", error);
  }
}
