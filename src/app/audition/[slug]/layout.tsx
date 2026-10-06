import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicAudition } from "@/lib/auditions";

export async function generateMetadata({ params }: LayoutProps<"/audition/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const row = await getPublicAudition(slug);
  if (!row) return { title: "Audition not found" };
  return {
    title: `${row.audition.title} · ${row.production.title}`,
    description: row.audition.description ?? `Sign up to audition for ${row.production.title}.`,
    robots: { index: false },
  };
}

/** Public, signed-out audition pages: branded with the production's title and accent color. */
export default async function PublicAuditionLayout({ children, params }: LayoutProps<"/audition/[slug]">) {
  const { slug } = await params;
  const row = await getPublicAudition(slug);
  if (!row) notFound();
  const { production, org } = row;
  const accent = /^#[0-9a-f]{3,8}$/i.test(production.accentColor) ? production.accentColor : "#6d28d9";
  // The production color is a user-picked tint only (docs/DESIGN.md): never text, button fill or the
  // focus ring, so contrast for a signed-out parent arriving from a flyer never depends on it.
  const style = { "--prod": accent } as CSSProperties;

  return (
    <div style={style} className="min-h-dvh">
      <header className="relative overflow-hidden border-b border-line bg-[color-mix(in_oklab,var(--prod)_16%,var(--bg))]">
        <div className="relative mx-auto max-w-xl px-4 pb-8 pt-8">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted">
            <span aria-hidden className="size-2.5 rounded-full" style={{ background: "var(--prod)" }} />
            {org.name}
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl">{production.title}</h1>
          {production.subtitle ? <p className="mt-1 text-muted">{production.subtitle}</p> : null}
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto -mt-4 max-w-xl px-4 pb-16 outline-none">{children}</main>
      <footer className="pb-8 text-center text-xs text-muted">
        Scheduling by <span className="font-display font-semibold text-ink">Call<span className="text-gold">time</span></span>
      </footer>
    </div>
  );
}
