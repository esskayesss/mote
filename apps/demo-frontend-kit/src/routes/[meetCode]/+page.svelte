<script lang="ts">
  import MeetingRoom from "$lib/pages/meeting-room.svelte";

  let { params } = $props();
</script>

<MeetingRoom meetCode={params.meetCode} />
