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
    "block min-h-32 w-full rounded-none border border-input bg-background px-4 py-3.5 text-sm leading-6 text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-[border-color,box-shadow] outline-none ring-0 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-white/20 focus-visible:ring-1 focus-visible:ring-white/12 disabled:cursor-not-allowed disabled:opacity-50",
    className
  )}
  bind:value
  oninput={oninput}
  {...rest}
></textarea>
