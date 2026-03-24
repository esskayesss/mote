<script lang="ts">
  import type { HTMLTextareaAttributes } from "svelte/elements";
  import { cn } from "../utils";

  type TextareaProps = HTMLTextareaAttributes & {
    class?: string;
  };

  let {
    class: className,
    oninput,
    value = $bindable(),
    ...rest
  }: TextareaProps & { value?: HTMLTextareaAttributes["value"] } = $props();
</script>

<textarea
  class={cn(
    "block min-h-32 w-full rounded-none border border-input bg-background px-4 py-3.5 text-sm leading-6 text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
    className
  )}
  bind:value
  oninput={oninput}
  {...rest}
></textarea>
