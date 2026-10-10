import { connection } from "next/server";

import { ssoControllers } from "@resumerank/core/sso/jackson";
import { json, jsonFailure, jsonRejection } from "@/server/sso-routes";

/** Auth.js (server-to-server) reads the signed-in person's profile with the access token. */
export async function GET(request: Request): Promise<Response> {
  await connection();
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token) return jsonRejection("userinfo", 401, "missing bearer token");

  try {
    const { oauthController } = await ssoControllers();
    return json(await oauthController.userInfo(token));
  } catch (error) {
    return jsonFailure("userinfo", error);
  }
}
