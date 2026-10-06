"use client";

import { Check, Copy, Share2 } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { buttonClass, Textarea } from "@/components/ui";

const noop = () => () => {};
/** True only on the client when the native share sheet exists (no hydration mismatch). */
function useCanShare() {
  return useSyncExternalStore(
    noop,
    () => typeof navigator !== "undefined" && "share" in navigator,
    () => false,
  );
}

/**
 * Invite link + an editable prewritten message. "Share" opens the phone's share sheet (Messages,
 * WhatsApp, email…); otherwise copy the message or just the link.
 */
export function ShareInvite({ url, message, compact = false }: { url: string; message: string; compact?: boolean }) {
  const canShare = useCanShare();
  const [text, setText] = useState(message);
  const [copied, setCopied] = useState<"msg" | "link" | null>(null);
  const copy = async (what: "msg" | "link") => {
    await navigator.clipboard.writeText(what === "msg" ? text : url);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };
  return (
    <div className="space-y-2">
      {!compact ? (
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Message to send</span>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-20 text-base" />
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {canShare ? (
          <button
            type="button"
            className={buttonClass("primary")}
            onClick={() => navigator.share({ text: compact ? message : text }).catch(() => {})}
          >
            <Share2 className="size-4" /> Share invite
          </button>
        ) : (
          <button type="button" className={buttonClass(compact ? "secondary" : "primary")} onClick={() => copy("msg")}>
            {copied === "msg" ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied === "msg" ? "Copied" : "Copy message"}
          </button>
        )}
        <button type="button" className={buttonClass("secondary")} onClick={() => copy("link")}>
          {copied === "link" ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied === "link" ? "Copied" : "Copy link only"}
        </button>
      </div>
    </div>
  );
}
