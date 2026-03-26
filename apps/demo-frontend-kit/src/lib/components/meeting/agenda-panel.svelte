<script lang="ts">
  import Icon from "@iconify/svelte";
  import { cn } from "@mote/ui";
  import type {
    AgendaArtifactPoint,
    AgendaArtifactSubtopic,
    AgendaExecutionStatus,
    RoomSummary
  } from "@mote/models";

  interface Props {
    collapsedAgendaPoints: Record<string, boolean>;
    onToggleAgendaPoint: (pointId: string) => void;
    room: RoomSummary | null;
  }

  let { collapsedAgendaPoints, onToggleAgendaPoint, room }: Props = $props();

  const getAgendaStatusIcon = (status: AgendaExecutionStatus | undefined) => {
    switch (status) {
      case "completed":
        return "ph:check-circle";
      case "partially_completed":
        return "ph:half-circle";
      case "active":
        return "ph:play-circle";
      default:
        return "ph:circle-dashed";
    }
  };

  const getAgendaStatusClass = (status: AgendaExecutionStatus | undefined) => {
    switch (status) {
      case "completed":
        return "text-success";
      case "partially_completed":
        return "text-warning";
      case "active":
        return "text-info";
      default:
        return "text-subtle-foreground";
    }
  };

  const getAgendaLabel = (kind: "topic" | "subtopic", order: number) =>
    kind === "topic" ? `${order}.` : `${String.fromCharCode(64 + order)}.`;

  const isPointCollapsed = (pointId: string) => collapsedAgendaPoints[pointId] ?? false;
  const isActivePoint = (point: AgendaArtifactPoint) =>
    point.status === "active" || point.subtopics.some((subtopic) => subtopic.status === "active");
  const getActiveSubtopic = (point: AgendaArtifactPoint) =>
    point.subtopics.find((subtopic) => subtopic.status === "active") ?? null;
  const getPresenterTalkingPoints = (point: AgendaArtifactPoint) => {
    const activeSubtopic = getActiveSubtopic(point);

    if (activeSubtopic && (activeSubtopic.talkingPoints?.length ?? 0) > 0) {
      return {
        label: activeSubtopic.title,
        items: activeSubtopic.talkingPoints ?? []
      };
    }

    return {
      label: point.title,
      items: point.talkingPoints
    };
  };
</script>

{#snippet agendaEntryRow(
  entry: AgendaArtifactPoint | AgendaArtifactSubtopic,
  kind: "topic" | "subtopic",
  collapsed = false
)}
  <div class={cn("flex items-center gap-3 border border-border bg-panel-subtle px-4 py-3 text-sm leading-5 text-foreground-soft", kind === "subtopic" && "bg-panel-subtle-2")}>
    <div class="flex items-center gap-3 shrink-0 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-subtle-foreground">
      <span>{getAgendaLabel(kind, entry.order)}</span>
      <span class={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center", getAgendaStatusClass(entry.status))}>
        <Icon icon={getAgendaStatusIcon(entry.status)} width="16" height="16" />
      </span>
    </div>
    <div class="min-w-0 flex-1">
      <strong class={cn("block truncate font-mono text-[12px] font-medium tracking-[0.02em]", kind === "topic" ? "text-foreground" : "text-muted-foreground")}>
        {entry.title}
      </strong>
    </div>

    {#if kind === "topic"}
      <button
        class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-subtle-foreground transition hover:text-foreground"
        type="button"
        aria-label={collapsed ? "Expand topic" : "Collapse topic"}
        onclick={() => onToggleAgendaPoint(entry.id)}
      >
        <Icon icon={collapsed ? "ph:caret-right" : "ph:caret-down"} width="14" height="14" />
      </button>
    {:else}
      <div class="pointer-events-none mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-subtle-foreground"></div>
    {/if}

  </div>
{/snippet}

{#if room?.agendaArtifact?.points?.length}
  <div class="flex flex-col gap-3">
    {#each room.agendaArtifact.points as point}
      <div class="flex flex-col gap-2">
        {@render agendaEntryRow(point, "topic", isPointCollapsed(point.id))}
        {#if isActivePoint(point) && getPresenterTalkingPoints(point).items.length}
          {@const presenterGuidance = getPresenterTalkingPoints(point)}
          <div class="border border-info/25 bg-info/8 px-4 py-3 text-sm text-foreground-soft">
            <div class="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-info">
              Current talking points · {presenterGuidance.label}
            </div>
            <div class="flex flex-col gap-2">
              {#each presenterGuidance.items as talkingPoint}
                <div class="flex items-start gap-2 leading-5">
                  <span class="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-info"></span>
                  <span>{talkingPoint}</span>
                </div>
              {/each}
            </div>
          </div>
        {/if}
        {#if !isPointCollapsed(point.id) && point.subtopics.length}
          <div class="flex flex-col gap-2 pl-7">
            {#each point.subtopics as subtopic}
              {@render agendaEntryRow(subtopic, "subtopic")}
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{:else if room?.agenda?.length}
  <div class="flex flex-col gap-3">
    {#each room.agenda as topic, index}
      <div class="flex items-center gap-3 border border-border bg-panel-subtle px-4 py-3 text-sm leading-5 text-foreground-soft">
        <div class="pointer-events-none mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-subtle-foreground"></div>
        <span class="shrink-0 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-subtle-foreground">{index + 1}.</span>
        <span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-subtle-foreground">
          <Icon icon="ph:circle-dashed" width="16" height="16" />
        </span>
        <div class="min-w-0 flex-1">
          <strong class="block truncate font-mono text-[12px] font-medium tracking-[0.02em] text-foreground">{topic}</strong>
        </div>
      </div>
    {/each}
  </div>
{:else}
  <div class="flex min-h-full flex-col items-center justify-center gap-3 border border-border bg-panel-muted px-8 py-12 text-center">
    <strong class="text-lg font-semibold text-foreground">No agenda set</strong>
    <p class="text-sm leading-6 text-subtle-foreground">This meeting has no agenda source of truth yet.</p>
  </div>
{/if}
