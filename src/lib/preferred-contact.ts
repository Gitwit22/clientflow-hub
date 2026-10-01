export interface ContactDetails {
  phone?: string;
  email?: string;
  /** Kept separately when the intake asked for them (`intake.workPhone`, `intake.cellPhone`). */
  workPhone?: string;
  cellPhone?: string;
}

const PHONE_WORDS = /phone|call|text|sms|mobile|cell|number|work|office|home|landline/i;

/**
 * A client's preferred contact method turned into something staff can act on: email shows their
 * address as a mailto: link; any phone choice ("Phone", "Work number", "Cell", "Text me") shows the
 * matching number — their cell for cell/mobile/text, their work number for work/office, else the
 * profile phone — as a tel: (or sms:) link. Anything else is shown as given.
 */
export function preferredContactLink(
  preference: string | undefined,
  details: ContactDetails,
): { method: string; value?: string; href?: string } | null {
  const method = (preference ?? "").trim();
  if (!method) return null;
  const email = (details.email ?? "").trim();
  if (/e-?mail/i.test(method)) {
    return email ? { method, value: email, href: `mailto:${email}` } : { method };
  }
  if (!PHONE_WORDS.test(method)) return { method };

  const pick = (...numbers: Array<string | undefined>) =>
    numbers.map((value) => (value ?? "").trim()).find(Boolean) ?? "";
  const wantsCell = /mobile|cell|text|sms/i.test(method);
  const wantsWork = /work|office|landline/i.test(method);
  const phone = wantsCell
    ? pick(details.cellPhone, details.phone, details.workPhone)
    : wantsWork
      ? pick(details.workPhone, details.phone, details.cellPhone)
      : pick(details.phone, details.cellPhone, details.workPhone);
  if (!phone) return { method };

  const digits = phone.replace(/[^\d+]/g, "");
  const sms = /text|sms/i.test(method) && !/call|phone/i.test(method);
  return { method, value: phone, href: `${sms ? "sms" : "tel"}:${digits}` };
}
