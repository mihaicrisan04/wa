import { getPreferenceValues } from "@raycast/api";
import { createWaClient, type WaClient } from "@wa/sdk";
import { defaultHome, engineUrl, parsePort, resolveToken } from "./settings";

export function enginePort(): number {
  return parsePort(getPreferenceValues<Preferences>().port);
}

export async function engineClient(): Promise<WaClient> {
  const token = await resolveToken(getPreferenceValues<Preferences>().token, defaultHome());
  return createWaClient({ baseUrl: engineUrl(enginePort()), token });
}
