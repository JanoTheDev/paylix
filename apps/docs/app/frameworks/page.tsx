import type { Metadata } from "next";
import Link from "next/link";
import { PageHeading, SectionHeading } from "@/components/docs";

export const metadata: Metadata = { title: "Framework Examples" };

const frameworks = [
  {
    href: "/frameworks/nextjs-app-router",
    title: "Next.js (App Router)",
    description: "Next.js 13+ with Route Handlers and Server Actions.",
  },
  {
    href: "/frameworks/nextjs-pages-router",
    title: "Next.js (Pages Router)",
    description: "Classic Pages Router with pages/api/ handlers.",
  },
  {
    href: "/frameworks/react-vite",
    title: "React (Vite)",
    description: "Vite + React SPA with a small Express backend.",
  },
  {
    href: "/frameworks/sveltekit",
    title: "SvelteKit",
    description: "Form actions and +server.ts endpoints.",
  },
  {
    href: "/frameworks/nuxt",
    title: "Nuxt 3",
    description: "server/api/ routes with runtime config.",
  },
  {
    href: "/frameworks/remix",
    title: "Remix",
    description: "Loaders and actions with .server.ts modules.",
  },
  {
    href: "/frameworks/express",
    title: "Express / Fastify",
    description: "Standalone Node.js backend for any client.",
  },
];

export default function FrameworksIndex() {
  return (
    <>
      <PageHeading
        title="Framework Examples"
        description="Step-by-step integration guides for the most popular frameworks. Each guide walks through install, environment variables, file structure, and the code you need to create checkouts, verify payments, and handle webhooks."
      />

      <SectionHeading>Pick your framework</SectionHeading>
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {frameworks.map((f) => (
          <Link
            key={f.href}
            href={f.href}
            className="group rounded-lg border border-border bg-surface-1 p-5 transition-colors hover:border-border-strong hover:bg-surface-2"
          >
            <div className="text-sm font-semibold text-foreground">
              {f.title}
            </div>
            <div className="mt-1 text-xs leading-relaxed text-foreground-muted">
              {f.description}
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
