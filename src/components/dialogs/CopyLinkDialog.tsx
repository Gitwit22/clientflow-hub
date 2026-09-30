import { Check, Copy } from "lucide-react";
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

/**
 * Shows a one-time link (staff invite or password reset) for an admin to copy and send. The app
 * doesn't email these, and the link isn't shown again once this closes.
 */
export function CopyLinkDialog({
  open,
  onOpenChange,
  title,
  description,
  link,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  link: string;
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
