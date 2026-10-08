/** A `+`, the country code, U+2219 bullets, then the last digits: `+40∙∙∙∙∙∙∙50`. */
const MASKED_PHONE = /^\+\d+∙+\d+$/;

/**
 * WhatsApp sends a masked phone number as the full name of people not saved in the phone;
 * it is a placeholder, not a name, and must not hide their push name.
 */
export function isMaskedPhone(name: string): boolean {
  return MASKED_PHONE.test(name);
}

/** The first candidate that is an actual name. */
export function realName(...candidates: (string | null | undefined)[]): string | undefined {
  return candidates.find((name): name is string => !!name && !isMaskedPhone(name));
}
