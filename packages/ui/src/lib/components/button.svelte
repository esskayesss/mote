<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";
  import { tv } from "tailwind-variants";
  import { cn } from "../utils";

  const buttonVariants = tv({
    base: "flex items-center justify-center gap-2 whitespace-nowrap rounded-none border border-transparent text-sm font-semibold leading-none tracking-[-0.01em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
    variants: {
      variant: {
        default: "border-primary bg-primary text-primary-foreground shadow-lg shadow-stone-950/15 hover:bg-primary/92",
        secondary: "border-border bg-secondary text-secondary-foreground hover:bg-secondary/80",
        outline: "border-border bg-transparent text-foreground hover:bg-stone-950/5",
        ghost: "bg-transparent text-foreground hover:bg-stone-950/5"
      },
      size: {
        default: "min-h-12 px-5 py-3",
        sm: "min-h-10 px-4 py-2.5 text-xs",
        lg: "min-h-13 px-6 py-3.5"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  });

  type Variant = "default" | "secondary" | "outline" | "ghost";
  type Size = "default" | "sm" | "lg";

  type ButtonProps = HTMLButtonAttributes & {
    children?: Snippet;
    class?: string;
    size?: Size;
    variant?: Variant;
  };

  let {
    children,
    class: className,
    onclick,
    size = "default",
    type = "button",
    variant = "default",
    ...rest
  }: ButtonProps = $props();
</script>

<button
  class={cn(buttonVariants({ variant, size }), className)}
  onclick={onclick}
  type={type}
  {...rest}
>
  {@render children?.()}
</button>
