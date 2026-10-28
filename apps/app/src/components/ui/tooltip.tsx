// shadcn/ui's Tooltip (new-york v4, apps/v4/registry/new-york-v4/ui/tooltip.tsx) on Radix's
// primitive, restyled to the site's tokens: `fg` ground, `ink` text, 2px corners, 11px type. Radix
// places it and, with `collisionPadding`, slides it along its side to stay inside the window.
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ComponentProps } from "react";

function TooltipProvider({
  delayDuration = 0,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

function Tooltip(props: ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger(props: ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className = "",
  sideOffset = 6,
  collisionPadding = 16,
  children,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        className={`tooltip-content z-50 w-fit rounded-[2px] bg-fg px-1.5 py-1 text-[11px] text-ink ${className}`}
        collisionPadding={collisionPadding}
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="fill-fg" height={4} width={8} />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
