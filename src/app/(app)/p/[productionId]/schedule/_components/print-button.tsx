"use client";

import { Printer } from "lucide-react";
import { buttonClass } from "@/components/ui";

export function PrintButton() {
  return (
    <button type="button" className={buttonClass("ghost")} onClick={() => window.print()}>
      <Printer className="size-4" /> Print
    </button>
  );
}
