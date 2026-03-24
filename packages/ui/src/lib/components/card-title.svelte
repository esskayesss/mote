<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "../utils";

  type CardTitleProps = HTMLAttributes<HTMLHeadingElement> & {
    children?: Snippet;
    class?: string;
  };

  let { children, class: className, ...rest }: CardTitleProps = $props();
</script>

<h2 class={cn("font-semibold tracking-tight text-foreground", className)} {...rest}>
  {@render children?.()}
</h2>

