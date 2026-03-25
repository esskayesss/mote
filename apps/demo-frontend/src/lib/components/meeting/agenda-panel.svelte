<script lang="ts">
  import Icon from "@iconify/svelte";
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
      case "active":
        return "ph:play-circle";
      default:
        return "ph:circle-dashed";
    }
  };

  const getAgendaStatusClass = (status: AgendaExecutionStatus | undefined) => {
    switch (status) {
      case "completed":
        return "agenda-entry-status agenda-entry-status-completed";
      case "active":
        return "agenda-entry-status agenda-entry-status-active";
      default:
        return "agenda-entry-status agenda-entry-status-pending";
    }
  };

  const getAgendaLabel = (kind: "topic" | "subtopic", order: number) =>
    kind === "topic" ? `${order}.` : `${String.fromCharCode(64 + order)}.`;

  const isPointCollapsed = (pointId: string) => collapsedAgendaPoints[pointId] ?? false;
</script>

{#snippet agendaEntryRow(
  entry: AgendaArtifactPoint | AgendaArtifactSubtopic,
  kind: "topic" | "subtopic",
  collapsed = false
)}
  <div class={`agenda-entry ${kind === "subtopic" ? "agenda-entry-subtopic" : ""}`}>
    {#if kind === "topic"}
      <button
        class="agenda-entry-toggle"
        type="button"
        aria-label={collapsed ? "Expand topic" : "Collapse topic"}
        onclick={() => onToggleAgendaPoint(entry.id)}
      >
        <Icon icon={collapsed ? "ph:caret-right" : "ph:caret-down"} width="14" height="14" />
      </button>
    {:else}
      <div class="agenda-entry-toggle agenda-entry-toggle-spacer"></div>
    {/if}

    <span class="agenda-entry-index">{getAgendaLabel(kind, entry.order)}</span>
    <span class={getAgendaStatusClass(entry.status)}>
      <Icon icon={getAgendaStatusIcon(entry.status)} width="16" height="16" />
    </span>
    <div class="agenda-entry-copy">
      <strong>{entry.title}</strong>
      {#if "objective" in entry && entry.objective}
        <p>{entry.objective}</p>
      {/if}
    </div>
  </div>
{/snippet}

{#if room?.agendaArtifact?.points?.length}
  <div class="sidebar-list">
    {#each room.agendaArtifact.points as point}
      <div class="agenda-group">
        {@render agendaEntryRow(point, "topic", isPointCollapsed(point.id))}
        {#if !isPointCollapsed(point.id) && point.subtopics.length}
          <div class="agenda-group-children">
            {#each point.subtopics as subtopic}
              {@render agendaEntryRow(subtopic, "subtopic")}
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{:else if room?.agenda?.length}
  <div class="sidebar-list">
    {#each room.agenda as topic, index}
      <div class="agenda-entry">
        <div class="agenda-entry-toggle agenda-entry-toggle-spacer"></div>
        <span class="agenda-entry-index">{index + 1}.</span>
        <span class="agenda-entry-status agenda-entry-status-pending">
          <Icon icon="ph:circle-dashed" width="16" height="16" />
        </span>
        <div class="agenda-entry-copy">
          <strong>{topic}</strong>
        </div>
      </div>
    {/each}
  </div>
{:else}
  <div class="sidebar-empty">
    <strong>No agenda set</strong>
    <p>This meeting has no agenda source of truth yet.</p>
  </div>
{/if}
