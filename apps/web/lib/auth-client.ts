import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";

// better-auth's inferred client type references internal .mjs paths
// that aren't re-exported, so the top-level declared type can't be
// named across module boundaries (TS2742). Annotating as `any` breaks
// the name-resolution requirement; destructured members below are
// still fully typed via their individual ReturnType lookups.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const authClient: any = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  plugins: [organizationClient()],
});

export const {
  signIn,
  signUp,
  signOut,
  useSession,
  organization,
  useListOrganizations,
  useActiveOrganization,
} = authClient;
