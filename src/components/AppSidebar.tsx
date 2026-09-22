import { Link, useRouterState } from "@tanstack/react-router";
import {
  Archive,
  BarChart3,
  Briefcase,
  ClipboardCheck,
  ClipboardList,
  FileSignature,
  LayoutDashboard,
  LogOut,
  Settings,
  Timer,
  UserPlus,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { logout } from "@/lib/apiClient";
import { useAppState } from "@/lib/store";

type NavItem = { title: string; url: string; icon: typeof Users; exact?: boolean };

const mainItems: NavItem[] = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, exact: true },
  { title: "Clients", url: "/clients", icon: Users },
  { title: "New Intake", url: "/intake", icon: UserPlus },
  { title: "Programs", url: "/programs", icon: Briefcase },
  { title: "Forms", url: "/forms", icon: ClipboardList },
  { title: "Review", url: "/review", icon: ClipboardCheck },
  { title: "Monitoring", url: "/monitoring", icon: Timer },
  { title: "Contracts", url: "/contracts", icon: FileSignature },
];

const insightItems: NavItem[] = [
  { title: "Reports", url: "/reports", icon: BarChart3 },
  { title: "Archive", url: "/archive", icon: Archive },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { authenticatedAdmin } = useAppState();
  const displayName =
    [authenticatedAdmin?.firstName, authenticatedAdmin?.lastName].filter(Boolean).join(" ") ||
    authenticatedAdmin?.email ||
    "Signed in";
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  async function handleLogout() {
    try {
      await logout();
    } finally {
      window.location.assign("/login");
    }
  }

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Brand */}
      <div className="flex items-center gap-3 border-b border-sidebar-border px-5.5 py-6.5">
        <img
          src="/logo.svg"
          alt="ClientFlow"
          className="size-8.5 shrink-0 rounded-lg"
        />
        <div className="leading-tight">
          <p className="font-display text-[16.5px] font-semibold tracking-[0.2px] text-white">
            ClientFlow
          </p>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-sidebar-foreground/60">
            EA Management
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {mainItems.map((item) => {
          const active = item.exact ? pathname === item.url : pathname.startsWith(item.url);
          return (
            <Link
              key={item.url}
              to={item.url}
              onClick={onNavigate}
              className={cn(
                "relative flex items-center gap-3 rounded-[7px] px-3 py-2.5 text-[13.5px] font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/75 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
              )}
            >
              {active && (
                <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-sidebar-primary" />
              )}
              <item.icon
                className={cn(
                  "size-4",
                  active ? "text-sidebar-primary" : "text-sidebar-foreground/50",
                )}
              />
              {item.title}
            </Link>
          );
        })}

        <p className="px-3 pb-1.5 pt-3.5 font-mono text-[10px] uppercase tracking-widest text-sidebar-foreground/40">
          Insights
        </p>

        {insightItems.map((item) => {
          const active = pathname.startsWith(item.url);
          return (
            <Link
              key={item.url}
              to={item.url}
              onClick={onNavigate}
              className={cn(
                "relative flex items-center gap-3 rounded-[7px] px-3 py-2.5 text-[13.5px] font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/75 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
              )}
            >
              {active && (
                <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-sidebar-primary" />
              )}
              <item.icon
                className={cn(
                  "size-4",
                  active ? "text-sidebar-primary" : "text-sidebar-foreground/50",
                )}
              />
              {item.title}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border px-4.5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="flex size-7.5 shrink-0 items-center justify-center rounded-[7px] bg-sidebar-accent font-mono text-xs font-medium text-sidebar-foreground">
            {initials}
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium leading-tight text-sidebar-foreground">
              {displayName}
            </p>
            <p className="font-mono text-[10.5px] capitalize text-sidebar-foreground/60">
              {authenticatedAdmin?.jobTitle || authenticatedAdmin?.role?.replace("_", " ") || "Admin"}
            </p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="ml-auto flex size-7 items-center justify-center rounded-md text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            aria-label="Log out"
            title="Log out"
          >
            <LogOut className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
