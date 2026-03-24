<script lang="ts">
  import type { Snippet } from "svelte";
  import { tv } from "tailwind-variants";
  import { cn } from "../utils";

  const badgeVariants = tv({
    base: "inline-flex items-center rounded-none border px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.16em]",
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border bg-transparent text-foreground"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  });

  type BadgeProps = {
    children?: Snippet;
    class?: string;
    variant?: "default" | "secondary" | "outline";
  };

  let { children, class: className, variant = "default" }: BadgeProps = $props();
</script>

<span class={cn(badgeVariants({ variant }), className)}>
  {@render children?.()}
</span>
