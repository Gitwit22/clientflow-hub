import { preferredContactLink } from "@/lib/preferred-contact";

/** The client's preferred way to be reached, with the number or address to use it. */
export function PreferredContact({
  preference,
  phone,
  email,
}: {
  preference?: string;
  phone?: string;
  email?: string;
}) {
  const contact = preferredContactLink(preference, { phone, email });
  if (!contact) return <>—</>;
  return (
    <span>
      {contact.method}
      {contact.href && (
        <>
          {" · "}
          <a href={contact.href} className="text-primary underline-offset-2 hover:underline">
            {contact.value}
          </a>
        </>
      )}
    </span>
  );
}
