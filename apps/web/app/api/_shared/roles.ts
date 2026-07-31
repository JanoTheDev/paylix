/**
 * Organization role checks.
 *
 * The implementation lives in `lib/require-active-org.ts` so the indexer and
 * dashboard server components can reach it too — `app/api/_shared` is only
 * importable from routes. `assertRole` reuses the `role` that
 * `resolveActiveOrg()` already resolved, so the gate costs no extra query.
 */

export {
  PRIVILEGED_ROLES,
  OWNER_ONLY,
  ORG_ROLES,
  getOrgRole,
  assertRole as requireRole,
  type OrgRole,
  type RoleResult,
} from "@/lib/require-active-org";
