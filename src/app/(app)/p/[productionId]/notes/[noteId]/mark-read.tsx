"use client";

import { useEffect } from "react";
import { markNoteRead } from "../actions";

/** Opening a note marks it read for the people the viewer covers. Runs once after the page shows. */
export function MarkRead({ productionId, noteId }: { productionId: string; noteId: string }) {
  useEffect(() => {
    void markNoteRead(productionId, noteId);
  }, [productionId, noteId]);
  return null;
}
