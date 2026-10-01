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

/**
 * The same send actions as the header menu, laid out as buttons on the Forms tab so intake,
 * forms, the contract and the welcome email can be sent from where staff review the answers.
 */
export function ClientSendPanel({
  hasEnrollment,
  onSelect,
}: {
  hasEnrollment: boolean;
  onSelect: (kind: SendKind) => void;
}) {
  const availability = sendAvailability({ hasEnrollment });
  const blockedReason = SEND_KINDS.map(({ kind }) => availability[kind].reason).find(Boolean);

  return (
    <Card className="shadow-card">
      <CardHeader className="pb-2">
        <CardTitle className="font-display text-base">Send to client</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {SEND_KINDS.map(({ kind, label, hint }) => (
            <Button
              key={kind}
              type="button"
              size="sm"
              variant="outline"
              title={availability[kind].reason ?? hint}
              disabled={!availability[kind].enabled}
              onClick={() => onSelect(kind)}
            >
              <Send className="size-3.5" />
              {label}
            </Button>
          ))}
        </div>
        {blockedReason && <p className="text-xs text-muted-foreground">{blockedReason}</p>}
      </CardContent>
    </Card>
  );
}
