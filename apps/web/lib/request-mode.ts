import { cookies } from "next/headers";

export type PaylixMode = "test" | "live";
export const MODE_COOKIE_NAME = "paylix_mode";

/** Pure parser for the cookie value — exported for unit tests. */
export function parseModeCookie(value: string | undefined): PaylixMode {
  return value === "live" ? "live" : "test";
}

/** Reads the dashboard's current mode from the `paylix_mode` cookie. Defaults to "test". */
export async function getDashboardMode(): Promise<PaylixMode> {
  const store = await cookies();
  return parseModeCookie(store.get(MODE_COOKIE_NAME)?.value);
}

/** Returns the livemode boolean for DB queries. */
export async function getDashboardLivemode(): Promise<boolean> {
  return (await getDashboardMode()) === "live";
}
