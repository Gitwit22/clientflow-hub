import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AgreementText } from "@/components/AgreementText";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  acfAcceptPublicContract,
  acfGetPublicContract,
  ApiError,
  type AutomatedPublicContractData,
} from "@/lib/apiClient";

export const Route = createFileRoute("/agreements/$token")({
  head: () => ({
    meta: [{ title: "Review your agreement — ClientFlow" }],
  }),
  component: PublicContractPage,
});

type PageStatus = "loading" | "ready" | "submitting" | "success" | "not_found" | "gone" | "error";

type Field = "name" | "email" | "agree" | "scroll" | "note";
type FieldErrors = Partial<Record<Field, string>>;

const NAME_MAX = 160;
const NOTE_MAX = 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const SIGNING_MESSAGES = {
  name: "Type your full name — it's your signature.",
  nameTooLong: `Keep your name under ${NAME_MAX} characters.`,
  email: "Enter a valid email address, like name@example.com.",
  agree: "Tick the box to confirm you've read and agree.",
  scroll: "Scroll to the end of the agreement before signing.",
  note: `Keep the note under ${NOTE_MAX} characters.`,
  summary: "Please fix the items marked below, then sign again.",
  network:
    "We couldn't reach the server. Check your internet connection and try again — what you typed is still here.",
  server: "Something went wrong on our side. Please try again in a minute.",
  tooMany: "Too many attempts in a short time. Please wait a minute and try again.",
  invalid: "Some details weren't accepted. Please check them and try again.",
} as const;

/** What the signer has to fix before the agreement can be signed. */
function validate(values: {
  name: string;
  email: string;
  agreed: boolean;
  reachedEnd: boolean;
  note: string;
}): FieldErrors {
  const errors: FieldErrors = {};
  const name = values.name.trim();
  if (name.length < 2) errors.name = SIGNING_MESSAGES.name;
  else if (name.length > NAME_MAX) errors.name = SIGNING_MESSAGES.nameTooLong;
  if (!EMAIL_PATTERN.test(values.email.trim())) errors.email = SIGNING_MESSAGES.email;
  if (!values.reachedEnd) errors.scroll = SIGNING_MESSAGES.scroll;
  else if (!values.agreed) errors.agree = SIGNING_MESSAGES.agree;
  if (values.note.trim().length > NOTE_MAX) errors.note = SIGNING_MESSAGES.note;
  return errors;
}

/**
 * The server's validation messages as the signer's fields. Newer servers send the signer's
 * wording; older ones name the field ("signedEmail must be an email"). Either is recognised.
 */
function serverFieldErrors(message: string): FieldErrors {
  const errors: FieldErrors = {};
  if (/signedName|full name|your name/i.test(message)) errors.name = SIGNING_MESSAGES.name;
  if (/signedEmail|email address/i.test(message)) errors.email = SIGNING_MESSAGES.email;
  if (/agreedToTerms|tick the box/i.test(message)) errors.agree = SIGNING_MESSAGES.agree;
  if (/signatureNote|the note/i.test(message)) errors.note = SIGNING_MESSAGES.note;
  return errors;
}

function PublicContractPage() {
  const { token } = Route.useParams();
  const [status, setStatus] = useState<PageStatus>("loading");
  const [data, setData] = useState<AutomatedPublicContractData | null>(null);
  const [signedName, setSignedName] = useState("");
  const [signedEmail, setSignedEmail] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [signatureNote, setSignatureNote] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [loadError, setLoadError] = useState("");
  // Signing unlocks once the end of the agreement has been seen, and stays unlocked.
  const [reachedEnd, setReachedEnd] = useState(false);
  const submitting = useRef(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const agreeRef = useRef<HTMLButtonElement>(null);
  const jumpRef = useRef<HTMLButtonElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    acfGetPublicContract(token)
      .then((result) => {
        setData(result);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) {
          setStatus("not_found");
        } else {
          setLoadError(
            error instanceof ApiError
              ? "Unable to load the agreement. Please try again or contact us directly."
              : "We couldn't reach the server. Check your internet connection and reload the page.",
          );
          setStatus("error");
        }
      });
  }, [token]);

  const checkScrolledToEnd = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    if (box.scrollTop + box.clientHeight >= box.scrollHeight - 8) setReachedEnd(true);
  }, []);

  // A short agreement that fits in the box is read without scrolling. Otherwise the end marker
  // is watched (with a scroll check as well, for browsers without IntersectionObserver).
  useEffect(() => {
    if (!data || reachedEnd) return;
    const box = boxRef.current;
    const end = endRef.current;
    if (!box || !end) return;
    if (box.scrollHeight > 0 && box.scrollHeight <= box.clientHeight + 8) {
      setReachedEnd(true);
      return;
    }
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setReachedEnd(true);
      },
      { root: box, threshold: 1 },
    );
    observer.observe(end);
    return () => observer.disconnect();
  }, [data, reachedEnd]);

  useEffect(() => {
    if (reachedEnd) setErrors((current) => ({ ...current, scroll: undefined }));
  }, [reachedEnd]);

  function clearError(field: Field) {
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
    setFormError("");
  }

  function jumpToEnd() {
    const box = boxRef.current;
    if (box) box.scrollTo?.({ top: box.scrollHeight, behavior: "smooth" });
    setReachedEnd(true);
  }

  function focusFirst(found: FieldErrors) {
    const order: Array<[Field, { current: HTMLElement | null }]> = [
      ["scroll", jumpRef],
      ["name", nameRef],
      ["email", emailRef],
      ["note", noteRef],
      ["agree", agreeRef],
    ];
    const first = order.find(([field]) => found[field]);
    first?.[1].current?.focus();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    const found = validate({
      name: signedName,
      email: signedEmail,
      agreed: agreedToTerms,
      reachedEnd,
      note: signatureNote,
    });
    if (Object.values(found).some(Boolean)) {
      setErrors(found);
      setFormError(SIGNING_MESSAGES.summary);
      focusFirst(found);
      return;
    }

    submitting.current = true;
    setStatus("submitting");
    setFormError("");
    try {
      await acfAcceptPublicContract(token, {
        signedName: signedName.trim(),
        signedEmail: signedEmail.trim(),
        agreedToTerms: true,
        signatureNote: signatureNote.trim() || undefined,
      });
      setStatus("success");
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        // Expired, cancelled or already signed while the page was open.
        setStatus("gone");
        return;
      }
      setStatus("ready");
      if (!(error instanceof ApiError)) {
        setFormError(SIGNING_MESSAGES.network);
      } else if (error.status === 400) {
        const fieldErrors = serverFieldErrors(error.message);
        setErrors(fieldErrors);
        setFormError(
          Object.keys(fieldErrors).length ? SIGNING_MESSAGES.summary : SIGNING_MESSAGES.invalid,
        );
        focusFirst(fieldErrors);
      } else if (error.status === 429) {
        setFormError(SIGNING_MESSAGES.tooMany);
      } else {
        setFormError(SIGNING_MESSAGES.server);
      }
    } finally {
      submitting.current = false;
    }
  }

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading your agreement…</p>
      </div>
    );
  }

  if (status === "not_found" || status === "gone") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-md space-y-3 text-center">
          <h1 className="font-display text-2xl font-semibold">
            {status === "gone" ? "This signing link is no longer available" : "Link not found"}
          </h1>
          <p className="text-muted-foreground">
            The link may have expired, been replaced with a newer one, or the agreement may already
            be signed.{" "}
            {data?.program.name
              ? `Please contact the ${data.program.name} team for a new link.`
              : "Please contact us if you need a new link."}
          </p>
        </div>
      </div>
    );
  }

  if (status === "error" && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-md space-y-3 text-center">
          <h1 className="font-display text-2xl font-semibold">Something went wrong</h1>
          <p className="text-muted-foreground">{loadError}</p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="font-display text-3xl font-semibold">Agreement signed!</h1>
          <p className="text-lg text-muted-foreground">
            {data?.contract.purpose === "award"
              ? "Thank you. A signed copy will be emailed to you."
              : "Thank you. Your onboarding has started and a welcome email is on its way."}
          </p>
        </div>
      </div>
    );
  }

  if (!data) return null;
  const busy = status === "submitting";
  const describedBy = (field: Field) => (errors[field] ? `${field}-error` : undefined);
  const fieldError = (field: Field) =>
    errors[field] ? (
      <p id={`${field}-error`} className="text-sm font-medium text-destructive">
        {errors[field]}
      </p>
    ) : null;

  return (
    <div className="min-h-screen bg-background px-4 py-10 md:py-14">
      <div className="mx-auto max-w-3xl space-y-8">
        {data.headerImageUrl && (
          <img
            src={data.headerImageUrl}
            alt=""
            className="mx-auto max-h-24 w-auto max-w-full object-contain"
            onError={(event) => {
              // A logo that can't load is hidden rather than shown broken.
              event.currentTarget.hidden = true;
            }}
          />
        )}
        <div className="space-y-1">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            {data.program.name}
          </p>
          <h1 className="font-display text-3xl font-semibold leading-tight">
            {data.contract.contractName}
          </h1>
          <p className="text-muted-foreground">
            Please read the whole agreement. You can sign once you reach the end.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card shadow-sm">
          <div
            ref={boxRef}
            onScroll={checkScrolledToEnd}
            tabIndex={0}
            aria-label="Agreement text"
            className="max-h-[70vh] overflow-y-auto px-6 py-6 text-base leading-relaxed text-foreground md:px-10 md:py-8 md:text-[17px]"
          >
            <AgreementText text={data.contract.content} />
            <div ref={endRef} aria-hidden className="h-px" />
          </div>
          <div
            className={`flex flex-wrap items-center justify-between gap-2 border-t border-border px-6 py-3 text-sm md:px-10 ${
              errors.scroll ? "bg-destructive/5" : ""
            }`}
          >
            {reachedEnd ? (
              <span className="font-medium text-emerald-700 dark:text-emerald-300">
                You&apos;ve reached the end of the agreement.
              </span>
            ) : (
              <>
                <span
                  id="scroll-error"
                  className={
                    errors.scroll ? "font-medium text-destructive" : "text-muted-foreground"
                  }
                >
                  {errors.scroll ?? "Scroll to the end of the agreement to sign."}
                </span>
                <Button ref={jumpRef} type="button" size="sm" variant="outline" onClick={jumpToEnd}>
                  Jump to the end
                </Button>
              </>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          {formError && (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm font-medium text-destructive"
            >
              {formError}
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="signed-name" className="text-base">
              Full name (your signature) *
            </Label>
            <Input
              id="signed-name"
              ref={nameRef}
              value={signedName}
              autoComplete="name"
              maxLength={NAME_MAX + 20}
              aria-invalid={Boolean(errors.name) || undefined}
              aria-describedby={describedBy("name")}
              onChange={(event) => {
                setSignedName(event.target.value);
                clearError("name");
              }}
              disabled={busy}
              className="h-11 text-base"
            />
            {fieldError("name")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="signed-email" className="text-base">
              Email *
            </Label>
            <Input
              id="signed-email"
              ref={emailRef}
              type="email"
              inputMode="email"
              autoComplete="email"
              value={signedEmail}
              aria-invalid={Boolean(errors.email) || undefined}
              aria-describedby={describedBy("email")}
              onChange={(event) => {
                setSignedEmail(event.target.value);
                clearError("email");
              }}
              disabled={busy}
              className="h-11 text-base"
            />
            {fieldError("email")}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="signature-note" className="text-base">
              Note (optional)
            </Label>
            <Textarea
              id="signature-note"
              ref={noteRef}
              value={signatureNote}
              aria-invalid={Boolean(errors.note) || undefined}
              aria-describedby={describedBy("note") ?? "note-count"}
              onChange={(event) => {
                setSignatureNote(event.target.value);
                clearError("note");
              }}
              disabled={busy}
              rows={3}
              className="text-base"
            />
            <p
              id="note-count"
              className={`text-xs ${signatureNote.trim().length > NOTE_MAX ? "text-destructive" : "text-muted-foreground"}`}
            >
              {signatureNote.trim().length} / {NOTE_MAX}
            </p>
            {fieldError("note")}
          </div>
          <div className="space-y-1.5">
            <div className="flex items-start gap-3">
              <Checkbox
                id="agreed-to-terms"
                ref={agreeRef}
                checked={agreedToTerms}
                aria-invalid={Boolean(errors.agree) || undefined}
                aria-describedby={describedBy("agree") ?? (reachedEnd ? undefined : "scroll-error")}
                onCheckedChange={(checked) => {
                  setAgreedToTerms(checked === true);
                  clearError("agree");
                }}
                disabled={busy || !reachedEnd}
                className="mt-0.5 h-5 w-5"
              />
              <Label htmlFor="agreed-to-terms" className="text-base font-normal leading-snug">
                I have read and agree to the terms of this agreement.
              </Label>
            </div>
            {fieldError("agree")}
          </div>

          <Button type="submit" className="h-12 w-full text-base" disabled={busy || !reachedEnd}>
            {busy ? "Signing…" : reachedEnd ? "Sign agreement" : "Scroll to the end to sign"}
          </Button>
        </form>
      </div>
    </div>
  );
}
