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
  const style = {
    "--accent": accent,
    "--accent-ink": "#ffffff",
    "--accent-soft": `color-mix(in srgb, ${accent} 14%, var(--surface))`,
  } as CSSProperties;

  return (
    <div style={style} className="min-h-dvh">
      <header className="relative overflow-hidden bg-accent text-accent-ink">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,.22),transparent_60%)]" aria-hidden />
        <div className="relative mx-auto max-w-xl px-4 pb-8 pt-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-80">{org.name}</p>
          <h1 className="mt-2 font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{production.title}</h1>
          {production.subtitle ? <p className="mt-1 opacity-90">{production.subtitle}</p> : null}
        </div>
      </header>
      <main className="mx-auto -mt-4 max-w-xl px-4 pb-16">{children}</main>
      <footer className="pb-8 text-center text-xs text-muted">
        Scheduling by <span className="font-display font-semibold text-ink">Call<span className="text-gold">time</span></span>
      </footer>
    </div>
  );
}
