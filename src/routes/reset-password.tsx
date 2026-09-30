import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff, KeyRound, LockKeyhole } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, resetPassword, validateResetLink } from "@/lib/apiClient";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [{ title: "Reset your password — ClientFlow" }],
  }),
  component: ResetPasswordPage,
});

/** Opened from the one-time link an admin sends from Settings (there is no emailed reset). */
function ResetPasswordPage() {
  const navigate = useNavigate();
  const search = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const token = search.get("token") ?? "";

  const [status, setStatus] = useState<"loading" | "valid" | "invalid">("loading");
  const [email, setEmail] = useState("");
  const [invalidReason, setInvalidReason] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setInvalidReason("No reset token found in the link.");
      setStatus("invalid");
      return;
    }
    validateResetLink(token)
      .then((result) => {
        if (result.valid) {
          setEmail(result.email ?? "");
          setStatus("valid");
        } else {
          setInvalidReason(result.reason ?? "This reset link is invalid or has expired.");
          setStatus("invalid");
        }
      })
      .catch(() => {
        setInvalidReason("Could not check this reset link. Please try again later.");
        setStatus("invalid");
      });
  }, [token]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      const result = await resetPassword(token, password);
      toast.success(result.message);
      await navigate({ to: "/login", replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Checking your reset link…</p>
      </div>
    );
  }

  if (status === "invalid") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-sm space-y-4 text-center">
          <div className="flex justify-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <LockKeyhole className="size-6" />
            </span>
          </div>
          <h1 className="text-xl font-semibold">Reset link invalid</h1>
          <p className="text-sm text-muted-foreground">{invalidReason}</p>
        </div>
      </div>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-14">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <span className="mb-4 flex size-11 items-center justify-center rounded-md bg-primary/10 text-primary">
            <KeyRound className="size-5" />
          </span>
          <h1 className="font-display text-2xl font-bold tracking-tight">Set a new password</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            For <span className="font-medium text-foreground">{email}</span>. You'll be signed out
            everywhere and can sign in with the new password.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="password">New password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Min. 8 characters"
                required
                className="pr-10"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
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
              onChange={(event) => setConfirm(event.target.value)}
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
            {isSubmitting ? "Saving…" : "Set new password"}
          </Button>
        </form>
      </div>
    </main>
  );
}
