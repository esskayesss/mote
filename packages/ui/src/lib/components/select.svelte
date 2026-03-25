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

  const selectedOption = $derived(options.find((option) => option.value === value) ?? null);

  const statusClass = (status: SelectOption["status"]) => {
    switch (status) {
      case "ready":
        return "bg-emerald-400";
      case "unavailable":
        return "bg-red-400";
      default:
        return "bg-stone-500";
    }
  };

  const asClassName = (value: unknown) => (typeof value === "string" ? value : "");
</script>

<SelectPrimitive.Root type="single" {name} {onValueChange} bind:value>
  <SelectPrimitive.Trigger
    class={cn(
      "flex min-h-12 w-full items-center justify-between gap-3 rounded-none border border-input bg-background px-4 py-3 text-sm text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-[border-color,box-shadow] outline-none ring-0 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-white/20 focus-visible:ring-1 focus-visible:ring-white/12 disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted-foreground",
      className
    )}
  >
    <span class="flex min-w-0 items-center gap-3 truncate">
      {#if selectedOption}
        <span class={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", statusClass(selectedOption.status))}></span>
        <span class="truncate">{selectedOption.label}</span>
      {:else}
        <span class="truncate">{placeholder}</span>
      {/if}
    </span>
    <ChevronDown class="h-4 w-4 shrink-0 text-stone-500" />
  </SelectPrimitive.Trigger>

  <SelectPrimitive.Content sideOffset={8}>
    {#snippet child({ props, wrapperProps })}
      <div
        {...wrapperProps}
        class={cn(
          "z-50 w-[var(--bits-select-anchor-width)] min-w-[var(--bits-select-anchor-width)] overflow-hidden rounded-none border border-white/10 bg-[#171719] text-white shadow-2xl shadow-black/40",
          asClassName(wrapperProps.class)
        )}
      >
        <div
          {...props}
          class={cn(
            "w-full bg-[#171719] p-1",
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
                class="flex min-h-11 cursor-default items-center justify-between gap-3 rounded-none px-3 py-2 text-sm text-stone-200 outline-none transition-colors focus-visible:outline-none data-[highlighted]:bg-[#232326] data-[disabled]:pointer-events-none data-[disabled]:opacity-40"
              >
                <span class="flex min-w-0 items-center gap-3 truncate">
                  <span class={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", statusClass(option.status))}></span>
                  <span class="truncate">{option.label}</span>
                </span>
              </SelectPrimitive.Item>
            {/each}
          </SelectPrimitive.Viewport>
        </div>
      </div>
    {/snippet}
  </SelectPrimitive.Content>
</SelectPrimitive.Root>
