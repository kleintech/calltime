import type { MetadataRoute } from "next";

/** PWA manifest — "Add to Home Screen" opens Calltime full-screen on the Calls tab. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Calltime",
    short_name: "Calltime",
    description: "Your rehearsal calls, always up to date.",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f3ee",
    theme_color: "#f6f3ee",
    categories: ["productivity", "entertainment", "education"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "My calls", url: "/home" },
      { name: "Calendar", url: "/home/calendar" },
    ],
  };
}
