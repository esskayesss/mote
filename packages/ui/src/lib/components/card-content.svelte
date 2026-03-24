<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "../utils";

  type CardContentProps = HTMLAttributes<HTMLDivElement> & {
    children?: Snippet;
    class?: string;
  };

  let { children, class: className, ...rest }: CardContentProps = $props();
</script>

<div class={cn("px-6 pb-6", className)} {...rest}>
  {@render children?.()}
</div>

