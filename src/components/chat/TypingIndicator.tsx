export function TypingIndicator() {
  return (
    <div className="flex flex-col items-start">
      <span className="mb-1 text-xs text-paper-600">Composure</span>
      <div className="mr-auto rounded-lg bg-paper-700 px-3 py-2 dark:bg-paper-300">
        <div className="flex items-center gap-1">
          <span className="h-2 w-2 animate-bounce rounded-full bg-paper-600 dark:bg-paper-500" style={{ animationDelay: "0ms" }} />
          <span className="h-2 w-2 animate-bounce rounded-full bg-paper-600 dark:bg-paper-500" style={{ animationDelay: "150ms" }} />
          <span className="h-2 w-2 animate-bounce rounded-full bg-paper-600 dark:bg-paper-500" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    </div>
  );
}
