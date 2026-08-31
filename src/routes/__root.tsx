import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AppSidebarNav } from "@/components/AppSidebar";
import { Toaster } from "@/components/ui/sonner";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import { retryBootstrap, useAppState } from "@/lib/store";
import { restoreSession } from "@/lib/apiClient";
import { useBootstrap } from "@/hooks/use-bootstrap";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "ClientFlow — Client Intake & Program Workflow Portal" },
      {
        name: "description",
        content:
          "ClientFlow centralizes client intake, program routing, forms, terms, monitoring, contracts and final reports in one admin portal.",
      },
      { name: "author", content: "EA Management" },
      { property: "og:title", content: "ClientFlow — Client Intake & Program Workflow Portal" },
      {
        property: "og:description",
        content: "One master client profile from intake through contract, monitoring and archive.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/logo.svg", type: "image/svg+xml" },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon", sizes: "any" },
      { rel: "apple-touch-icon", href: "/logo.svg" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { authStatus } = useAppState();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    void restoreSession();
  }, []);

  const isPublicRoute =
    pathname === "/login" || pathname.startsWith("/accept-invite") || pathname.startsWith("/s/");

  return (
    <QueryClientProvider client={queryClient}>
      {isPublicRoute ? (
        <Outlet />
      ) : !hydrated || authStatus === "checking" ? (
        <AccessCheck />
      ) : authStatus === "authenticated" ? (
        <AuthenticatedShell />
      ) : (
        <AuthRedirect />
      )}
      <Toaster position="top-right" richColors />
    </QueryClientProvider>
  );
}

function AccessCheck() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p className="text-sm text-muted-foreground">Checking access...</p>
    </div>
  );
}

function AuthRedirect() {
  const router = useRouter();

  useEffect(() => {
    void router.navigate({ to: "/login", replace: true });
  }, [router]);

  return <AccessCheck />;
}

function AuthenticatedShell() {
  useBootstrap();
  const { bootstrapStatus, bootstrapError } = useAppState();
  return (
    <>
      <div className="flex min-h-screen w-full bg-background font-sans">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 lg:block">
          <AppSidebarNav />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-3 border-b border-border bg-sidebar px-4 py-3 lg:hidden">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Open navigation" className="border-sidebar-border text-sidebar-foreground hover:bg-sidebar-accent">
                  <Menu className="size-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0">
                <AppSidebarNav />
              </SheetContent>
            </Sheet>
            <span className="font-display text-sm font-semibold text-white">ClientFlow</span>
          </header>

          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {bootstrapStatus === "ready" ? (
              <Outlet />
            ) : bootstrapStatus === "error" ? (
              <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center text-center">
                <h1 className="font-display text-xl font-semibold">ClientFlow could not load</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  {bootstrapError ?? "The server did not return your organization data."}
                </p>
                <Button className="mt-5" onClick={retryBootstrap}>Retry</Button>
              </div>
            ) : (
              <AccessCheck />
            )}
          </main>
        </div>
      </div>
    </>
  );
}
