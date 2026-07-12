import { codeToHtml } from "shiki";
import { CopyButton } from "./copy-button";

interface CodeBlockProps {
  children: string;
  language?: string;
  filename?: string;
}

export async function CodeBlock({
  children,
  language = "ts",
  filename,
}: CodeBlockProps) {
  const code = children.trim();
  const html = await codeToHtml(code, {
    lang: language,
    theme: "github-dark-default",
    transformers: [
      {
        pre(node) {
          if (node.properties) {
            delete (node.properties as Record<string, unknown>).style;
          }
          return node;
        },
      },
    ],
  });

  return (
    <div className="group relative my-6 overflow-hidden rounded-lg border border-border bg-surface-1">
      {filename && (
        <div className="flex items-center border-b border-border px-4 py-2 text-xs font-medium text-foreground-dim">
          <span className="font-mono">{filename}</span>
        </div>
      )}
      <div className="relative">
        <div
          className="[&_pre]:overflow-x-auto [&_pre]:px-4 [&_pre]:py-4 [&_pre]:text-[13px] [&_pre]:leading-relaxed [&_code]:font-mono"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: html is generated at build time by shiki's codeToHtml() from local MDX source, not user input
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
          <CopyButton value={code} />
        </div>
      </div>
    </div>
  );
}
