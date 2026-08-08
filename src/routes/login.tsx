import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Eye, EyeOff, LockKeyhole, ShieldCheck, Workflow } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, login } from "@/lib/apiClient";
import { useAppState } from "@/lib/store";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — ClientFlow" },
      { name: "description", content: "Sign in to the ClientFlow operations portal." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { accessToken } = useAppState();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (accessToken) {
      void navigate({ to: "/", replace: true });
    }
  }, [accessToken, navigate]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      await login({ email: email.trim(), password });
      await navigate({ to: "/", replace: true });
    } catch (caughtError) {
      setError(
        caughtError instanceof ApiError && caughtError.status === 401
          ? "The email or password is incorrect."
          : "ClientFlow could not sign you in. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen bg-background font-sans lg:grid-cols-[minmax(22rem,0.8fr)_minmax(32rem,1.2fr)]">
      <section className="relative hidden overflow-hidden bg-sidebar px-12 py-14 text-sidebar-foreground lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-y-0 right-0 w-px bg-sidebar-border" />
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <Workflow className="size-6" />
          </span>
          <div>
            <p className="font-display text-lg font-semibold text-sidebar-accent-foreground">
              ClientFlow
            </p>
            <p className="text-xs text-sidebar-foreground/60">EA Management Portal</p>
          </div>
        </div>

        <div className="max-w-md">
          <div className="mb-7 flex size-12 items-center justify-center rounded-md border border-sidebar-border bg-sidebar-accent">
            <ShieldCheck className="size-6 text-sidebar-primary" />
          </div>
          <h1 className="font-display text-4xl font-semibold leading-tight text-sidebar-accent-foreground">
            Your client operations, in one secure workspace.
          </h1>
          <p className="mt-5 max-w-sm text-sm leading-6 text-sidebar-foreground/70">
            Continue managing intake, programs, monitoring, contracts, and reporting.
          </p>
        </div>

        <p className="text-xs text-sidebar-foreground/45">NXT LVL Technology Solutions</p>
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <span className="flex size-10 items-center justify-center rounded-md bg-sidebar text-sidebar-primary">
              <Workflow className="size-5" />
            </span>
            <div>
              <p className="font-display font-semibold">ClientFlow</p>
              <p className="text-xs text-muted-foreground">EA Management Portal</p>
            </div>
          </div>

          <div className="mb-8">
            <span className="mb-5 flex size-10 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
              <LockKeyhole className="size-5" />
            </span>
            <h2 className="font-display text-2xl font-semibold text-foreground">Sign in</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Use your approved account to continue.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@company.com"
                className="h-11"
                required
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="h-11 pr-11"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {error ? (
              <p
                className="rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
                role="alert"
              >
                {error}
              </p>
            ) : null}

            <Button type="submit" className="h-11 w-full" disabled={isSubmitting}>
              {isSubmitting ? "Signing in..." : "Continue"}
              {!isSubmitting ? <ArrowRight className="size-4" /> : null}
            </Button>
          </form>

          <p className="mt-8 text-center text-xs text-muted-foreground">
            Access is limited to approved ClientFlow administrators.
          </p>
        </div>
      </section>
    </main>
  );
}
