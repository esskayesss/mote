<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "../utils";

  type CardDescriptionProps = HTMLAttributes<HTMLParagraphElement> & {
    children?: Snippet;
    class?: string;
  };

  let { children, class: className, ...rest }: CardDescriptionProps = $props();
</script>

<p class={cn("text-sm text-muted-foreground", className)} {...rest}>
  {@render children?.()}
</p>

