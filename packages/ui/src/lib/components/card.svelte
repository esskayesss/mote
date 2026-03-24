<script lang="ts">
  import type { Snippet } from "svelte";
  import type { SvelteHTMLElements } from "svelte/elements";
  import { cn } from "../utils";

  type CardProps = SvelteHTMLElements["section"] & {
    children?: Snippet;
    class?: string;
  };

  let { children, class: className, ...rest }: CardProps = $props();
</script>

<section
  class={cn("rounded-none border border-border bg-card text-card-foreground", className)}
  {...rest}
>
  {@render children?.()}
</section>
