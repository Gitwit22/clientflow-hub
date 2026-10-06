import { AlertTriangle, Check, Copy, MailCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { StaffEmailDelivery } from "@/lib/apiClient";
import { describeStaffEmailProblem } from "@/lib/staff-email";

/**
 * Shows a one-time link (staff invite or password reset) after it was emailed, so the admin can
 * see whether the email went out and copy the link to send it another way. The link isn't shown
 * again once this closes.
 */
export function CopyLinkDialog({
  open,
  onOpenChange,
  title,
  description,
  link,
  recipientEmail,
  emailDelivery,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  link: string;
  recipientEmail?: string;
  /** Missing on older API responses: then the link is only for copying. */
  emailDelivery?: StaffEmailDelivery;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy automatically. Select the link and copy it.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) setCopied(false);
        onOpenChange(value);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {emailDelivery?.status === "sent" && (
          <p
            role="status"
            className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
          >
            <MailCheck className="mt-0.5 size-4 shrink-0" />
            <span>
              Emailed to {recipientEmail ?? "them"}. If it doesn't arrive, copy the link below and
              send it yourself.
            </span>
          </p>
        )}
        {emailDelivery && emailDelivery.status !== "sent" && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>
              The email didn't send ({describeStaffEmailProblem(emailDelivery)}). Copy the link and
              send it to {recipientEmail ?? "them"} yourself.
            </span>
          </p>
        )}
        <div className="flex gap-2">
          <Input
            readOnly
            value={link}
            aria-label="Link"
            className="font-mono text-xs"
            onFocus={(event) => event.target.select()}
          />
          <Button type="button" onClick={() => void copy()}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Anyone with this link can use it, so send it only to this person. It won't be shown again;
          you can make a new one from Settings.
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
