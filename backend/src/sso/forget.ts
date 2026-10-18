import { isSsoEnabled } from "../env";
import { companyDirectory } from "./directory";
import { SSO_PRODUCT, ssoControllers } from "./jackson";

/**
 * Removes a company's identity provider connections and directory from the
 * SSO service when the company is deleted. Jackson keeps them in its own
 * tables, which no foreign key ties to the company, so the cascade can't.
 */
export async function forgetSsoTenant(companyId: string): Promise<void> {
  if (!isSsoEnabled()) return;
  const { connectionAPIController, directorySyncController } = await ssoControllers();

  const connections = await connectionAPIController.getConnections({ tenant: companyId, product: SSO_PRODUCT });
  for (const connection of connections) {
    await connectionAPIController.deleteConnections({
      clientID: connection.clientID,
      clientSecret: connection.clientSecret,
    });
  }

  const directory = await companyDirectory(companyId);
  if (directory) {
    const { error } = await directorySyncController.directories.delete(directory.id);
    if (error) throw new Error(`Directory delete failed: ${error.message}`);
  }
}
