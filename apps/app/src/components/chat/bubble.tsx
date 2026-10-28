// The visitor's message, Transitive's `Bubble` (`@transitive/ui`) in this site's language: the
// electric fill, white text, the 4px box, at most 85% of the thread.
import type { ReactNode } from "react";

export function Bubble({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full justify-end">
      <div className="w-fit max-w-[85%] min-w-0 rounded-[4px] bg-electric px-3 py-2 wrap-break-word whitespace-pre-wrap text-white">
        {children}
      </div>
    </div>
  );
}
