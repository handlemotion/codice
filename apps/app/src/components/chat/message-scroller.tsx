// The thread's scroller, from Transitive's `@transitive/ui` message-scroller over shadcn's
// primitive: it follows the newest message unless the reader scrolls up, and fades the thread
// out at whichever edge has more to read (`.scroll-fade` in styles.css).
import { MessageScroller as Primitive } from "@shadcn/react/message-scroller";
import type { ComponentProps } from "react";

export const MessageScrollerProvider = Primitive.Provider;

export function MessageScroller({
  className = "",
  ...props
}: ComponentProps<typeof Primitive.Root>) {
  return (
    <Primitive.Root
      className={`relative flex min-h-0 w-full flex-1 flex-col overflow-hidden ${className}`}
      {...props}
    />
  );
}

export function MessageScrollerViewport({
  className = "",
  ...props
}: ComponentProps<typeof Primitive.Viewport>) {
  return (
    <Primitive.Viewport
      className={`scroll-fade size-full outline-none min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-none [scrollbar-width:none] contain-content [&::-webkit-scrollbar]:hidden ${className}`}
      {...props}
    />
  );
}

export function MessageScrollerContent({
  className = "",
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Content
      className={`flex h-max w-full min-w-0 flex-col gap-6 ${className}`}
      {...props}
    />
  );
}

export function MessageScrollerItem({
  className = "",
  ...props
}: ComponentProps<typeof Primitive.Item>) {
  return <Primitive.Item className={`w-full min-w-0 shrink-0 ${className}`} {...props} />;
}
