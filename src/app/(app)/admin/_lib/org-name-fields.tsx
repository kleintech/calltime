"use client";

import { useState } from "react";
import { Field, Input } from "@/components/ui";
import { slugify } from "./slug";

/** Name + short name; the short name follows the name until edited by hand. */
export function OrgNameFields() {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);
  const shown = touched ? slug : name ? slugify(name) : "";
  return (
    <>
      <Field label="Company name">
        <Input name="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Lakeside Children's Theatre" autoComplete="off" />
      </Field>
      <Field label="Short name" hint="Used in links. Letters, numbers and dashes.">
        <Input
          name="slug"
          value={shown}
          onChange={(e) => {
            setTouched(true);
            setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"));
          }}
          placeholder="lakeside"
          autoComplete="off"
          className="font-mono text-sm"
        />
      </Field>
    </>
  );
}
