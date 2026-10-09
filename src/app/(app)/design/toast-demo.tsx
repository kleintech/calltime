"use client";

import { toast } from "@/components/toast";
import { Button } from "@/components/ui";

export function ToastDemo() {
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => toast("Published. 31 people notified.", { tone: "success" })}>
        Success toast
      </Button>
      <Button variant="secondary" onClick={() => toast("Block removed", { action: { label: "Undo", onClick: () => toast("Restored") } })}>
        Toast with Undo
      </Button>
      <Button variant="secondary" onClick={() => toast("Couldn't save — check your connection", { tone: "danger" })}>
        Error toast
      </Button>
    </div>
  );
}
