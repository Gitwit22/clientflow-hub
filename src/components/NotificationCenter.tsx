import { useEffect, useState } from "react";
import { Bell, CheckCheck, ClipboardCheck } from "lucide-react";
import {
  cfListNotifications,
  cfMarkAllNotificationsRead,
  cfMarkNotificationRead,
  type ClientflowNotification,
} from "@/lib/apiClient";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

function notificationTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function NotificationCenter({ inverted = false }: { inverted?: boolean }) {
  const [notifications, setNotifications] = useState<ClientflowNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const result = await cfListNotifications();
      setNotifications(result.items);
      setUnreadCount(result.unreadCount);
    } catch (error) {
      console.error("Unable to load notifications", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  async function markRead(notification: ClientflowNotification) {
    if (notification.readAt) return;
    const readAt = new Date().toISOString();
    setNotifications((current) =>
      current.map((item) => (item.id === notification.id ? { ...item, readAt } : item)),
    );
    setUnreadCount((current) => Math.max(0, current - 1));
    try {
      await cfMarkNotificationRead(notification.id);
    } catch (error) {
      console.error("Unable to mark notification read", error);
      void refresh();
    }
  }

  async function markAllRead() {
    const readAt = new Date().toISOString();
    setNotifications((current) => current.map((item) => ({ ...item, readAt })));
    setUnreadCount(0);
    try {
      await cfMarkAllNotificationsRead();
    } catch (error) {
      console.error("Unable to mark notifications read", error);
      void refresh();
    }
  }

  return (
    <Popover onOpenChange={(open) => open && void refresh()}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "relative size-9",
            inverted && "text-sidebar-foreground hover:bg-sidebar-accent hover:text-white",
          )}
          aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
          title="Notifications"
        >
          <Bell className="size-4.5" />
          {unreadCount > 0 ? (
            <span className="absolute right-0.5 top-0.5 flex min-w-4.5 items-center justify-center rounded-full bg-destructive px-1 font-mono text-[9px] font-semibold leading-4.5 text-destructive-foreground">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="flex h-12 items-center justify-between border-b border-border px-4">
          <div>
            <h2 className="text-sm font-semibold">Notifications</h2>
            <p className="text-xs text-muted-foreground">
              {unreadCount ? `${unreadCount} unread` : "You're up to date"}
            </p>
          </div>
          {unreadCount > 0 ? (
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={markAllRead}>
              <CheckCheck className="size-3.5" />
              Mark all read
            </Button>
          ) : null}
        </div>

        <div className="max-h-[min(28rem,70vh)] overflow-y-auto">
          {loading ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">Loading...</p>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center px-5 py-10 text-center">
              <span className="mb-3 flex size-10 items-center justify-center rounded-lg bg-muted">
                <Bell className="size-4 text-muted-foreground" />
              </span>
              <p className="text-sm font-medium">No notifications yet</p>
            </div>
          ) : (
            notifications.map((notification) => (
              <a
                key={notification.id}
                href={notification.actionUrl ?? undefined}
                onClick={() => void markRead(notification)}
                className={cn(
                  "flex gap-3 border-b border-border px-4 py-3.5 last:border-b-0",
                  notification.actionUrl && "hover:bg-muted/60",
                  !notification.readAt && "bg-primary/5",
                )}
              >
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <ClipboardCheck className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start gap-2">
                    <span className="flex-1 text-sm font-medium leading-5">{notification.title}</span>
                    {!notification.readAt ? (
                      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                    {notification.message}
                  </span>
                  <time className="mt-1 block font-mono text-[10px] text-muted-foreground/75">
                    {notificationTime(notification.createdAt)}
                  </time>
                </span>
              </a>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
