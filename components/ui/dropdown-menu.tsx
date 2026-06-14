'use client';

import * as React from "react"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import { Check, ChevronRight, Circle } from "lucide-react"

import { cn } from "@/lib/utils"

const DropdownMenu = DropdownMenuPrimitive.Root

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

const DropdownMenuGroup = DropdownMenuPrimitive.Group

const DropdownMenuPortal = DropdownMenuPrimitive.Portal

const DropdownMenuSub = DropdownMenuPrimitive.Sub

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

// Radix types sometimes omit className/children; widen locally so we can style them safely.
type DropdownMenuItemProps =
  DropdownMenuPrimitive.DropdownMenuItemProps & {
    onClick?: React.MouseEventHandler<HTMLDivElement>
    inset?: boolean
    className?: string
    children?: React.ReactNode
  }

type DropdownMenuPrimitiveCheckboxItemProps =
  DropdownMenuPrimitive.DropdownMenuCheckboxItemProps & {
    className?: string
    children?: React.ReactNode
    checked?: boolean | "indeterminate"
  }

type DropdownMenuPrimitiveRadioItemProps =
  DropdownMenuPrimitive.DropdownMenuRadioItemProps & {
    className?: string
    children?: React.ReactNode
  }

type DropdownMenuPrimitiveLabelProps =
  DropdownMenuPrimitive.DropdownMenuLabelProps & {
    className?: string
    children?: React.ReactNode
  }

type DropdownMenuPrimitiveSeparatorProps =
  DropdownMenuPrimitive.DropdownMenuSeparatorProps & {
    className?: string
  }

type DropdownMenuPrimitiveSubContentProps =
  DropdownMenuPrimitive.DropdownMenuSubContentProps & {
    className?: string
    children?: React.ReactNode
  }

type DropdownMenuPrimitiveSubTriggerProps =
  DropdownMenuPrimitive.DropdownMenuSubTriggerProps & {
    className?: string
    children?: React.ReactNode
    inset?: boolean
  }

const DropdownMenuPrimitiveSubTrigger =
  DropdownMenuPrimitive.SubTrigger as React.ForwardRefExoticComponent<
    DropdownMenuPrimitiveSubTriggerProps &
      React.RefAttributes<HTMLDivElement>
  >

const DropdownMenuPrimitiveSubContent =
  DropdownMenuPrimitive.SubContent as React.ForwardRefExoticComponent<
    DropdownMenuPrimitiveSubContentProps & React.RefAttributes<HTMLDivElement>
  >

const DropdownMenuPrimitiveItem =
  DropdownMenuPrimitive.Item as React.ForwardRefExoticComponent<
    DropdownMenuItemProps & React.RefAttributes<HTMLDivElement>
  >

const DropdownMenuPrimitiveLabel =
  DropdownMenuPrimitive.Label as React.ForwardRefExoticComponent<
    DropdownMenuPrimitiveLabelProps & React.RefAttributes<HTMLDivElement>
  >

const DropdownMenuPrimitiveSeparator =
  DropdownMenuPrimitive.Separator as React.ForwardRefExoticComponent<
    DropdownMenuPrimitiveSeparatorProps & React.RefAttributes<HTMLDivElement>
  >

const DropdownMenuPrimitiveCheckboxItem =
  DropdownMenuPrimitive.CheckboxItem as React.ForwardRefExoticComponent<
    DropdownMenuPrimitiveCheckboxItemProps &
      React.RefAttributes<HTMLDivElement>
  >

const DropdownMenuPrimitiveRadioItem =
  DropdownMenuPrimitive.RadioItem as React.ForwardRefExoticComponent<
    DropdownMenuPrimitiveRadioItemProps &
      React.RefAttributes<HTMLDivElement>
  >

const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  DropdownMenuPrimitiveSubTriggerProps
>(({ className, inset, children, ...props }, ref) => (
  <DropdownMenuPrimitiveSubTrigger
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-gray-100 data-[state=open]:bg-gray-100 dark:focus:bg-card dark:data-[state=open]:bg-card",
      inset && "pl-8",
      className
    )}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto h-4 w-4" />
  </DropdownMenuPrimitiveSubTrigger>
))
DropdownMenuSubTrigger.displayName =
  DropdownMenuPrimitive.SubTrigger.displayName

const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  DropdownMenuPrimitiveSubContentProps
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitiveSubContent
    ref={ref}
    className={cn(
      "z-50 min-w-[8rem] overflow-hidden rounded-md border border-gray-200 bg-white p-1 text-gray-950 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 dark:border-border/80 dark:bg-background dark:text-gray-50",
      className
    )}
    {...props}
  />
))
DropdownMenuSubContent.displayName =
  DropdownMenuPrimitive.SubContent.displayName

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 min-w-[8rem] overflow-hidden rounded-md border border-gray-200 bg-white p-1 text-gray-950 shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 dark:border-border/80 dark:bg-background dark:text-gray-50",
        className
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
))
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

const DropdownMenuItem = React.forwardRef<HTMLDivElement, DropdownMenuItemProps>(
  ({ className, ...props }, ref) => (
    <DropdownMenuPrimitiveItem
      ref={ref}
      className={cn(
        "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-gray-100 focus:text-gray-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:focus:bg-card dark:focus:text-gray-50",
        className
      )}
      {...props}
    />
  )
)
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

type DropdownMenuCheckboxItemProps = DropdownMenuPrimitiveCheckboxItemProps

const DropdownMenuCheckboxItem = React.forwardRef<
  HTMLDivElement,
  DropdownMenuCheckboxItemProps
>(({ className, children, checked, ...props }, ref) => (
  <DropdownMenuPrimitiveCheckboxItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-gray-100 focus:text-gray-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:focus:bg-card dark:focus:text-gray-50",
      className
    )}
    checked={checked}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitiveCheckboxItem>
))
DropdownMenuCheckboxItem.displayName =
  DropdownMenuPrimitive.CheckboxItem.displayName

type DropdownMenuRadioItemProps = DropdownMenuPrimitiveRadioItemProps

const DropdownMenuRadioItem = React.forwardRef<
  HTMLDivElement,
  DropdownMenuRadioItemProps
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitiveRadioItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-gray-100 focus:text-gray-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:focus:bg-card dark:focus:text-gray-50",
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Circle className="h-2 w-2 fill-current" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitiveRadioItem>
))
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName

const DropdownMenuLabel = React.forwardRef<
  HTMLDivElement,
  DropdownMenuPrimitiveLabelProps & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitiveLabel
    ref={ref}
    className={cn(
      "px-2 py-1.5 text-sm font-semibold",
      inset && "pl-8",
      className
    )}
    {...props}
  />
))
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName

const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  DropdownMenuPrimitiveSeparatorProps
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitiveSeparator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-gray-100 dark:bg-card", className)}
    {...props}
  />
))
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName

const DropdownMenuShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn("ml-auto text-xs tracking-widest opacity-60", className)}
      {...props}
    />
  )
}
DropdownMenuShortcut.displayName = "DropdownMenuShortcut"

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
}
