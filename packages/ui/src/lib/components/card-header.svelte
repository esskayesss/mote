<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "../utils";

  type CardHeaderProps = HTMLAttributes<HTMLDivElement> & {
    children?: Snippet;
    class?: string;
  };

  let { children, class: className, ...rest }: CardHeaderProps = $props();
</script>

<div class={cn("flex flex-col space-y-2 p-6", className)} {...rest}>
  {@render children?.()}
</div>

