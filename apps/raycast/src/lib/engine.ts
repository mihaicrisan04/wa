import { getPreferenceValues, Toast } from "@raycast/api";
import { createWaClient, engineUrl, type WaClient } from "@wa/sdk";
import { defaultHome } from "@wa/sdk/paths";
import { describeError, type ErrorDescription } from "./errors";
import { parsePort, resolveToken } from "./settings";

export function enginePort(): number {
  return parsePort(getPreferenceValues<Preferences>().port);
}

export async function engineClient(): Promise<WaClient> {
  const token = await resolveToken(getPreferenceValues<Preferences>().token, defaultHome());
  return createWaClient({ baseUrl: engineUrl(enginePort()), token });
}

export function describeEngineError(error: unknown): ErrorDescription {
  return describeError(error, enginePort());
}

/** Turns a toast that was tracking some work into its failure. */
export function failToast(toast: Toast, error: unknown): void {
  const { title, message } = describeEngineError(error);
  toast.style = Toast.Style.Failure;
  toast.title = title;
  toast.message = message;
}
