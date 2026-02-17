"use client";

import { useState, useEffect } from "react";
import { getHighlighter, getLangFromPath } from "@/lib/highlighter";
import type { ThemedToken } from "shiki";

interface HighlightedCodeProps {
  code: string;
  filePath: string;
}

export function HighlightedCode({ code, filePath }: HighlightedCodeProps) {
  const [tokenLines, setTokenLines] = useState<ThemedToken[][] | null>(null);
  const lang = getLangFromPath(filePath);

  useEffect(() => {
    if (!lang) {
      setTokenLines(null);
      return;
    }

    let cancelled = false;

    getHighlighter().then((highlighter) => {
      if (cancelled) return;
      const { tokens } = highlighter.codeToTokens(code, {
        lang,
        theme: "github-dark",
      });
      setTokenLines(tokens);
    });

    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  const lines = code.split("\n");

  // Highlighted view with tokens
  if (tokenLines) {
    return (
      <pre className="text-xs leading-relaxed">
        <code>
          {tokenLines.map((line, i) => (
            <div key={i} className="flex">
              <span className="inline-block w-10 shrink-0 select-none pr-3 text-right text-paper-600 dark:text-paper-400">
                {i + 1}
              </span>
              <span className="whitespace-pre-wrap break-all">
                {line.map((token, j) => (
                  <span key={j} style={{ color: token.color }}>
                    {token.content}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </code>
      </pre>
    );
  }

  // Fallback: plain text with line numbers (unsupported languages or while loading)
  return (
    <pre className="text-xs leading-relaxed">
      <code>
        {lines.map((line, i) => (
          <div key={i} className="flex">
            <span className="inline-block w-10 shrink-0 select-none pr-3 text-right text-paper-600 dark:text-paper-400">
              {i + 1}
            </span>
            <span className="whitespace-pre-wrap break-all text-paper-300 dark:text-paper-700">
              {line}
            </span>
          </div>
        ))}
      </code>
    </pre>
  );
}
