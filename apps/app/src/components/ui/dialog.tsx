// shadcn/ui's Dialog (new-york v4, apps/v4/registry/new-york-v4/ui/dialog.tsx) on Radix's
// primitive, restyled to the site's tokens: an island on a dimmed ground, 4px corners, regular
// weight, the central icons' cross.
import { IconCrossSmall } from "@central-icons-react/square-outlined-radius-0-stroke-1.5";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentProps } from "react";

function Dialog(props: ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger(props: ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal(props: ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose(props: ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className = "",
  ...props
}: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={`dialog-overlay fixed inset-0 z-50 bg-black/50 ${className}`}
      data-slot="dialog-overlay"
      {...props}
    />
  );
}

function DialogContent({
  className = "",
  children,
  showCloseButton = true,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { showCloseButton?: boolean }) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={`dialog-content fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-[4px] border border-line bg-island p-6 outline-none sm:max-w-md ${className}`}
        data-slot="dialog-content"
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            aria-label="Cerrar"
            className="absolute top-4 right-4 grid size-7 place-items-center text-muted hover:text-fg"
            data-slot="dialog-close"
          >
            <IconCrossSmall size={16} />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className = "", ...props }: ComponentProps<"div">) {
  return (
    <div className={`flex flex-col gap-2 ${className}`} data-slot="dialog-header" {...props} />
  );
}

function DialogFooter({ className = "", ...props }: ComponentProps<"div">) {
  return (
    <div
      className={`flex flex-col-reverse gap-2 sm:flex-row sm:justify-end ${className}`}
      data-slot="dialog-footer"
      {...props}
    />
  );
}

function DialogTitle({ className = "", ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={`text-[16px] leading-snug ${className}`}
      data-slot="dialog-title"
      {...props}
    />
  );
}

function DialogDescription({
  className = "",
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={`text-[13px] text-muted ${className}`}
      data-slot="dialog-description"
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
