import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * shadcn button restyled to Graphite and Jade. Primary is a jade fill
 * with dark ink at weight 700. Secondary is transparent with a hairline
 * border and muted text. Destructive is a red tint. Labels say exactly
 * what happens.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-btn text-[11.5px] font-semibold disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-jade-fill text-jade-ink font-bold border border-transparent",
        secondary: "bg-transparent border border-line text-muted hover:bg-raised hover:text-fg",
        destructive: "bg-red-dim text-red border border-transparent",
        ghost: "bg-transparent text-muted hover:bg-raised hover:text-fg border border-transparent",
      },
      size: {
        default: "px-[13px] py-[6px]",
        icon: "h-[30px] w-[30px] rounded-[9px]",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  ),
);
Button.displayName = "Button";

export { Button, buttonVariants };
