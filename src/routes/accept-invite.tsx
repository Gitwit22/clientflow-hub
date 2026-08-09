import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff, LockKeyhole, Workflow } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, acceptInvite, validateInvite } from "@/lib/apiClient";

export const Route = createFileRoute("/accept-invite")({
  head: () => ({
    meta: [{ title: "Set up your account — ClientFlow" }],
  }),
  component: AcceptInvitePage,
});

function AcceptInvitePage() {
  const navigate = useNavigate();
  const search = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : "",
  );
  const token = search.get("token") ?? "";

  const [status, setStatus] = useState<"loading" | "valid" | "invalid">("loading");
  const [prefillEmail, setPrefillEmail] = useState("");
  const [prefillName, setPrefillName] = useState("");
  const [invalidReason, setInvalidReason] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setInvalidReason("No invitation token found in the link.");
      setStatus("invalid");
      return;
    }
    validateInvite(token)
      .then((result) => {
        if (result.valid) {
          setPrefillEmail(result.email ?? "");
          setPrefillName(result.firstName ?? "");
          setStatus("valid");
        } else {
          setInvalidReason(result.reason ?? "This invitation link is invalid or has expired.");
          setStatus("invalid");
        }
      })
      .catch(() => {
        setInvalidReason("Could not validate this invitation. Please try again later.");
        setStatus("invalid");
      });
  }, [token]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      await acceptInvite(token, password);
      await navigate({ to: "/", replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Validating your invitation…</p>
      </div>
    );
  }

  if (status === "invalid") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-sm text-center space-y-4">
          <div className="flex justify-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <LockKeyhole className="size-6" />
            </span>
          </div>
          <h1 className="text-xl font-semibold">Invitation link invalid</h1>
          <p className="text-sm text-muted-foreground">{invalidReason}</p>
          <p className="text-sm text-muted-foreground">
            Contact your organization admin to request a new invitation.
          </p>
        </div>
      </div>
    );
  }

  return (
    <main className="grid min-h-screen bg-background font-sans lg:grid-cols-[minmax(22rem,0.8fr)_minmax(32rem,1.2fr)]">
      <section className="relative hidden overflow-hidden bg-sidebar px-12 py-14 text-sidebar-foreground lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-y-0 right-0 w-px bg-sidebar-border" />
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <Workflow className="size-6" />
          </span>
          <span className="text-xl font-bold tracking-tight font-display">ClientFlow</span>
        </div>
        <div>
          <p className="text-lg font-semibold font-display leading-snug">
            You've been invited to join the team.
          </p>
          <p className="mt-2 text-sm text-sidebar-foreground/70">
            Create a password to set up your account and get started.
          </p>
        </div>
      </section>

      <section className="flex flex-col items-center justify-center px-6 py-14 sm:px-12">
        <div className="w-full max-w-sm space-y-6">
          <div>
            <h1 className="text-2xl font-bold font-display tracking-tight text-foreground">
              {prefillName ? `Welcome, ${prefillName}` : "Set up your account"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a password for <span className="font-medium text-foreground">{prefillEmail}</span>
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  required
                  className="pr-10"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirm password</Label>
              <Input
                id="confirm"
                type={showPassword ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repeat your password"
                required
              />
            </div>

            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? "Setting up…" : "Create account"}
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}
