import { ChevronDown, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SEND_KINDS, sendAvailability, type SendKind } from "@/lib/client-send";

/**
 * The one "Send to client" entry point for the header. Every action here goes through the same
 * dialogs and backend services the automation uses; nothing sends from this component directly.
 */
export function ClientSendMenu({
  hasEnrollment,
  onSelect,
}: {
  hasEnrollment: boolean;
  onSelect: (kind: SendKind) => void;
}) {
  const availability = sendAvailability({ hasEnrollment });
  const blockedReason = SEND_KINDS.map(({ kind }) => availability[kind].reason).find(Boolean);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button">
          <Send className="size-4" />
          Send
          <ChevronDown className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {SEND_KINDS.map(({ kind, label, hint }) => (
          <DropdownMenuItem
            key={kind}
            disabled={!availability[kind].enabled}
            onSelect={() => onSelect(kind)}
            className="flex flex-col items-start gap-0.5"
          >
            <span className="font-medium">{label}</span>
            <span className="text-xs text-muted-foreground">{hint}</span>
          </DropdownMenuItem>
        ))}
        {blockedReason && (
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            {blockedReason}
          </DropdownMenuLabel>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
