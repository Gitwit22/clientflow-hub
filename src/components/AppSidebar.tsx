import { Link, useRouterState } from "@tanstack/react-router";
import {
  Archive,
  BarChart3,
  Briefcase,
  ClipboardList,
  FileSignature,
  LayoutDashboard,
  LogOut,
  Settings,
  Timer,
  UserPlus,
  Users,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { logout } from "@/lib/apiClient";
import { useAppState } from "@/lib/store";

const items: { title: string; url: string; icon: typeof Users; exact?: boolean }[] = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard, exact: true },
  { title: "Clients", url: "/clients", icon: Users },
  { title: "New Intake", url: "/intake", icon: UserPlus },
  { title: "Programs", url: "/programs", icon: Briefcase },
  { title: "Forms", url: "/forms", icon: ClipboardList },
  { title: "Monitoring", url: "/monitoring", icon: Timer },
  { title: "Contracts", url: "/contracts", icon: FileSignature },
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
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="flex size-9 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
          <Workflow className="size-5" />
        </span>
        <div className="leading-tight">
          <p className="font-display text-base font-semibold text-sidebar-accent-foreground">
            ClientFlow
          </p>
          <p className="text-[11px] text-sidebar-foreground/60">EA Management Portal</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        {items.map((item) => {
          const active = item.exact ? pathname === item.url : pathname.startsWith(item.url);
          return (
            <Link
              key={item.url}
              to={item.url}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              )}
            >
              <item.icon className={cn("size-4.5", active && "text-sidebar-primary")} />
              {item.title}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground">
            {initials}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-sidebar-accent-foreground">
              {displayName}
            </p>
            <p className="text-[11px] capitalize text-sidebar-foreground/60">
              {authenticatedAdmin?.role?.replace("_", " ") ?? "Admin"}
            </p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="ml-auto flex size-8 items-center justify-center rounded-md text-sidebar-foreground/55 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            aria-label="Log out"
            title="Log out"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
