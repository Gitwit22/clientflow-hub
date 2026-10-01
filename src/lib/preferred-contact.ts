/**
 * A client's preferred contact method turned into something staff can act on: "Phone" shows their
 * number as a tel: link, "Email" their address as a mailto: link. Anything else is shown as given.
 */
export function preferredContactLink(
  preference: string | undefined,
  details: { phone?: string; email?: string },
): { method: string; value?: string; href?: string } | null {
  const method = (preference ?? "").trim();
  if (!method) return null;
  const phone = (details.phone ?? "").trim();
  const email = (details.email ?? "").trim();
  if (/e-?mail/i.test(method) && email) {
    return { method, value: email, href: `mailto:${email}` };
  }
  if (/phone|call|text|sms|mobile|cell/i.test(method) && phone) {
    const digits = phone.replace(/[^\d+]/g, "");
    const sms = /text|sms/i.test(method) && !/call|phone/i.test(method);
    return { method, value: phone, href: `${sms ? "sms" : "tel"}:${digits}` };
  }
  return { method };
}
