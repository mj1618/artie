export function TypingIndicator() {
  return (
    <div className="flex flex-col items-start">
      <span className="mb-1 text-xs text-zinc-400">Artie</span>
      <div className="mr-auto rounded-lg bg-zinc-100 px-3 py-2 dark:bg-zinc-800">
        <div className="flex items-center gap-1">
          <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 dark:bg-zinc-500" style={{ animationDelay: "0ms" }} />
          <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 dark:bg-zinc-500" style={{ animationDelay: "150ms" }} />
          <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 dark:bg-zinc-500" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    </div>
  );
}
