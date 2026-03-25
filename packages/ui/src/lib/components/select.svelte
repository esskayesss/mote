<script lang="ts">
  import { ChevronDown } from "@lucide/svelte";
  import { Select as SelectPrimitive } from "bits-ui";
  import { cn } from "../utils";

  export type SelectOption = {
    value: string;
    label: string;
    status?: "ready" | "unavailable" | "neutral";
    disabled?: boolean;
  };

  type SelectProps = {
    class?: string;
    contentClass?: string;
    name?: string;
    onValueChange?: (value: string) => void;
    options: SelectOption[];
    placeholder?: string;
    value?: string;
  };

  let {
    class: className,
    contentClass,
    name,
    onValueChange,
    options,
    placeholder = "Select an option",
    value = $bindable("")
  }: SelectProps = $props();

  let triggerElement = $state<HTMLDivElement | null>(null);
  let triggerWidth = $state<number | null>(null);

  const selectedOption = $derived(options.find((option) => option.value === value) ?? null);
  const asClassName = (value: unknown) => (typeof value === "string" ? value : "");
  const asStyle = (value: unknown) => (typeof value === "string" ? value : "");
  const contentWidthStyle = $derived(
    triggerWidth ? `width: ${triggerWidth}px; min-width: ${triggerWidth}px;` : ""
  );

  $effect(() => {
    if (!triggerElement || typeof ResizeObserver === "undefined") {
      triggerWidth = triggerElement?.getBoundingClientRect().width ?? null;
      return;
    }

    const node = triggerElement;
    const syncWidth = () => {
      triggerWidth = node.getBoundingClientRect().width;
    };

    syncWidth();

    const observer = new ResizeObserver(syncWidth);
    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  });
</script>

<SelectPrimitive.Root type="single" {name} {onValueChange} bind:value>
  <div bind:this={triggerElement} class="w-full">
    <SelectPrimitive.Trigger
      class={cn(
        "flex min-h-12 w-full items-center justify-between gap-3 rounded-none border border-input bg-background px-4 py-3 text-sm text-foreground shadow-[inset_0_1px_0_var(--shadow-inset)] transition-[border-color,box-shadow] outline-none ring-0 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-border-strong focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted-foreground",
        className
      )}
    >
      <span class="flex min-w-0 items-center gap-3 truncate">
        {#if selectedOption}
          <span
            aria-hidden="true"
            class={`${
              selectedOption.status === "ready"
                ? "h-2.5 w-2.5 shrink-0 rounded-full bg-success"
                : selectedOption.status === "unavailable"
                  ? "h-2.5 w-2.5 shrink-0 rounded-full bg-destructive"
                  : "h-2.5 w-2.5 shrink-0 rounded-full bg-neutral"
            }`}
          ></span>
          <span class="truncate">{selectedOption.label}</span>
        {:else}
          <span class="truncate">{placeholder}</span>
        {/if}
      </span>
      <ChevronDown class="h-4 w-4 shrink-0 text-subtle-foreground" />
    </SelectPrimitive.Trigger>
  </div>

  <SelectPrimitive.Content sideOffset={8}>
    {#snippet child({ props, wrapperProps })}
      <div
        {...wrapperProps}
        style={`${contentWidthStyle} ${asStyle(wrapperProps.style)}`}
        class={cn(
          "z-50 overflow-hidden rounded-none border border-border bg-panel text-foreground shadow-2xl shadow-shadow/40",
          asClassName(wrapperProps.class)
        )}
      >
        <div
          {...props}
          class={cn(
            "w-full bg-panel p-1",
            contentClass,
            asClassName(props.class)
          )}
        >
          <SelectPrimitive.Viewport class="flex max-h-80 flex-col gap-1">
            {#each options as option (option.value)}
              <SelectPrimitive.Item
                value={option.value}
                label={option.label}
                disabled={option.disabled}
                class="flex min-h-11 cursor-default items-center justify-between gap-3 rounded-none px-3 py-2 text-sm text-foreground-soft outline-none transition-colors focus-visible:outline-none data-[highlighted]:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-40"
              >
                <div class="flex w-full items-center gap-3 truncate">
                  <span
                    aria-hidden="true"
                    class={`${
                      option.status === "ready"
                        ? "h-2.5 w-2.5 shrink-0 rounded-full bg-success"
                        : option.status === "unavailable"
                          ? "h-2.5 w-2.5 shrink-0 rounded-full bg-destructive"
                          : "h-2.5 w-2.5 shrink-0 rounded-full bg-neutral"
                    }`}
                  ></span>
                  <span class="truncate">{option.label}</span>
                </div>
              </SelectPrimitive.Item>
            {/each}
          </SelectPrimitive.Viewport>
        </div>
      </div>
    {/snippet}
  </SelectPrimitive.Content>
</SelectPrimitive.Root>
