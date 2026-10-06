"use client";

import { Check, Copy, Share2 } from "lucide-react";
import { useState } from "react";
import { buttonClass } from "./ui";

/** Copy a value (e.g. an invite link); uses the native share sheet when available on phones. */
export function CopyButton({ value, label = "Copy link", share = false }: { value: string; label?: string; share?: boolean }) {
  const [copied, setCopied] = useState(false);
  const canShare = share && typeof navigator !== "undefined" && "share" in navigator;
  return (
    <button
      type="button"
      className={buttonClass("secondary")}
      onClick={async () => {
        if (canShare) {
          try {
            await navigator.share({ url: value });
            return;
          } catch {
            /* fall through to copy */
          }
        }
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="size-4" /> : canShare ? <Share2 className="size-4" /> : <Copy className="size-4" />}
      {copied ? "Copied" : label}
    </button>
  );
}
