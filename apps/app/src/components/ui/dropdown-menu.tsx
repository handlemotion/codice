// shadcn/ui's DropdownMenu (new-york v4, apps/v4/registry/new-york-v4/ui/dropdown-menu.tsx) on
// Radix's primitive, the parts the dashboard uses, restyled to the site's tokens: an island with a
// `line` border, 2px items that take a `fg`/8 well on focus, regular weight.
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import type { ComponentProps } from "react";

function DropdownMenu(props: ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger(props: ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
  className = "",
  sideOffset = 4,
  collisionPadding = 16,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        className={`dropdown-content z-50 max-h-(--radix-dropdown-menu-content-available-height) min-w-56 overflow-x-hidden overflow-y-auto rounded-[4px] border border-line bg-island p-1 text-[13px] ${className}`}
        collisionPadding={collisionPadding}
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuGroup(props: ComponentProps<typeof DropdownMenuPrimitive.Group>) {
  return <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
}

function DropdownMenuItem({
  className = "",
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      className={`relative flex h-8 cursor-default items-center gap-2 rounded-[2px] px-2 outline-none select-none focus:bg-fg/8 data-disabled:pointer-events-none data-disabled:opacity-50 ${className}`}
      data-slot="dropdown-menu-item"
      {...props}
    />
  );
}

function DropdownMenuLabel({
  className = "",
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={`flex h-8 items-center px-2 text-muted ${className}`}
      data-slot="dropdown-menu-label"
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className = "",
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={`-mx-1 my-1 h-px bg-line ${className}`}
      data-slot="dropdown-menu-separator"
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
};
