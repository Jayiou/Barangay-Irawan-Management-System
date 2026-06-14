<template>
  <div class="health-manager">
    <div class="manager-head">
      <div>
        <span class="eyebrow">{{ t('common.healthCenter') }}</span>
        <h3>Events and queue access</h3>
      </div>
      <button class="ghost-button" type="button" @click="load" :disabled="loading">
        <i :class="loading ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-rotate-right'"></i>
        {{ t('components.activeQueueDashboard.refresh') }}
      </button>
    </div>

    <form class="event-form" @submit.prevent="saveEvent">
      <label><span>{{ t('common.ui.title') }}</span><input v-model.trim="form.title" required></label>
      <label><span>{{ t('common.ui.prefix') }}</span><input v-model.trim="form.prefix" maxlength="5" required></label>
      <label><span>{{ t('landing.formLabels.incidentDate') }}</span><input v-model="form.eventDate" type="date" required></label>
      <div class="time-grid">
        <label><span>{{ t('landing.formLabels.startTime') }}</span><input v-model="form.startTime" type="time" required></label>
        <label><span>{{ t('landing.formLabels.endTime') }}</span><input v-model="form.endTime" type="time" required></label>
      </div>
      <label><span>{{ t('landing.formLabels.description') }}</span><textarea v-model.trim="form.description" rows="3"></textarea></label>
      <div class="form-actions">
        <button class="primary-button" type="submit" :disabled="saving">
          <i :class="saving ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-floppy-disk'"></i>
          {{ editingId ? 'Save Changes' : 'Create Event' }}
        </button>
        <button type="button" class="ghost-button" @click="resetForm">{{ t('common.ui.reset') }}</button>
      </div>
    </form>

    <div class="event-toolbar">
      <h4>{{ t('common.ui.scheduledEvents') }}</h4>
      <span class="fine-print">{{ events.length }} total</span>
    </div>

    <div v-if="loading" class="empty-state">{{ t('common.ui.loadingHealthEvents') }}</div>
    <div v-else-if="!events.length" class="empty-state">{{ t('common.noHealthEvents') }}</div>
    <div v-else class="event-list">
      <article v-for="ev in events" :key="ev._id" class="event-row">
        <div class="event-main">
          <div class="event-title">
            <strong>{{ ev.title }}</strong>
            <span class="queue-pill" :class="{ open: ev.isQueueOpen }">{{ ev.isQueueOpen ? 'Queue open' : 'Queue closed' }}</span>
          </div>
          <div class="fine-print">{{ formatDate(ev.eventDate) }} | {{ ev.startTime }} - {{ ev.endTime }} | Prefix: {{ ev.prefix }}</div>
          <p v-if="ev.description" class="event-description">{{ ev.description }}</p>
        </div>
        <div class="event-actions">
          <button class="ghost-button" type="button" @click="toggleQueue(ev)">
            <i :class="ev.isQueueOpen ? 'fa-solid fa-lock' : 'fa-solid fa-unlock'"></i>
            {{ ev.isQueueOpen ? 'Close' : 'Open' }}
          </button>
          <button class="ghost-button" type="button" @click="editEvent(ev)">
            <i class="fa-solid fa-pen"></i>
            {{ t('common.ui.edit') }}
          </button>
          <button class="ghost-button danger-button" type="button" @click="deleteEvent(ev)" :disabled="deletingId === ev._id">
            <i :class="deletingId === ev._id ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-trash'"></i>
            {{ deletingId === ev._id ? 'Deleting...' : t('common.ui.delete') }}
          </button>
        </div>
      </article>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiFetch, formatDate } from '@/shared/client';

const { t } = useI18n();
const events = ref([]);
const loading = ref(false);
const saving = ref(false);
const deletingId = ref('');
const editingId = ref('');
const blankForm = () => ({ title: '', prefix: '', eventDate: '', startTime: '', endTime: '', description: '' });
const form = ref(blankForm());

const load = async () => {
  loading.value = true;
  try {
    const res = await apiFetch('/api/health-events');
    if (res?.success) events.value = res.data || [];
  } finally {
    loading.value = false;
  }
};

onMounted(load);

const saveEvent = async () => {
  saving.value = true;
  try {
    const path = editingId.value ? `/api/health-events/${editingId.value}` : '/api/health-events';
    const method = editingId.value ? 'PUT' : 'POST';
    await apiFetch(path, { method, body: form.value });
    resetForm();
    await load();
  } finally {
    saving.value = false;
  }
};

const resetForm = () => {
  editingId.value = '';
  form.value = blankForm();
};

const toggleQueue = async (ev) => {
  await apiFetch(`/api/health-events/${ev._id}/toggle-queue`, { method: 'POST', body: { open: !ev.isQueueOpen } });
  await load();
};

const editEvent = (ev) => {
  editingId.value = ev._id;
  form.value = {
    title: ev.title,
    prefix: ev.prefix,
    eventDate: new Date(ev.eventDate).toISOString().slice(0, 10),
    startTime: ev.startTime,
    endTime: ev.endTime,
    description: ev.description || ''
  };
};

const deleteEvent = async (ev) => {
  if (!globalThis.confirm(`Delete the scheduled event "${ev.title}"?`)) return;

  deletingId.value = ev._id;
  try {
    await apiFetch(`/api/health-events/${ev._id}`, { method: 'DELETE' });
    if (editingId.value === ev._id) resetForm();
    await load();
  } catch (error) {
    globalThis.alert(error.message || 'Failed to delete health event.');
  } finally {
    deletingId.value = '';
  }
};
</script>

<style scoped>
.health-manager { display: grid; gap: 16px; }
.manager-head, .event-toolbar, .event-row, .event-title, .event-actions, .form-actions {
  display: flex;
  align-items: center;
}
.manager-head, .event-toolbar, .event-row { justify-content: space-between; gap: 12px; }
.manager-head h3 { margin: 0; }
.event-form { display: grid; gap: 10px; max-width: 720px; }
.time-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.form-actions, .event-actions, .event-title { gap: 8px; flex-wrap: wrap; }
.event-list { display: grid; gap: 10px; }
.event-row { border: 1px solid #e1ebe6; border-radius: 8px; padding: 12px; align-items: flex-start; }
.event-main { display: grid; gap: 4px; min-width: 0; }
.event-description { margin: 4px 0 0; color: #42554b; }
.queue-pill { border-radius: 999px; padding: 3px 8px; background: #eef2f0; color: #52635a; font-size: 0.78rem; font-weight: 700; }
.queue-pill.open { background: #dff4e7; color: #166338; }
.danger-button { color: #b42318; border-color: #efc5c0; }
.danger-button:hover { background: #fff1ef; border-color: #d92d20; }
.empty-state { padding: 20px; text-align: center; color: #66736d; border: 1px dashed #d9e3de; border-radius: 8px; }
.fine-print { color: #666; font-size: 0.9rem; }
@media (max-width: 720px) {
  .manager-head, .event-row { align-items: stretch; flex-direction: column; }
  .time-grid { grid-template-columns: 1fr; }
}
</style>
