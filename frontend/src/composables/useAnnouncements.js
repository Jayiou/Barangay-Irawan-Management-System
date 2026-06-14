import { ref, reactive } from 'vue';
import { apiFetch } from '@/shared/client';

export function useAnnouncements() {
    const announcements = ref([]);
    const announcementImageFile = ref(null);
    const nextDisplayOrder = ref(null);
    const nextDisplayOrderLoading = ref(false);
    const announcementForm = reactive({
        title: '',
        description: '',
        displayOrder: 1,
        startDate: '',
        endDate: '',
        isActive: true,
        isImportant: false
    });

    const fetchNextDisplayOrder = async () => {
        try {
            nextDisplayOrderLoading.value = true;
            const response = await apiFetch('/announcements/admin/next-order');
            nextDisplayOrder.value = response?.data?.nextDisplayOrder || 1;
        } catch (error) {
            console.error('Failed to fetch next display order:', error);
            nextDisplayOrder.value = 1;
        } finally {
            nextDisplayOrderLoading.value = false;
        }
    };

    const resetAnnouncementForm = () => {
        announcementForm.title = '';
        announcementForm.description = '';
        announcementForm.displayOrder = nextDisplayOrder.value || 1;
        announcementForm.startDate = '';
        announcementForm.endDate = '';
        announcementForm.isActive = true;
        announcementForm.isImportant = false;
        announcementImageFile.value = null;
    };

    const onImageUpload = (event) => {
        announcementImageFile.value = event.target.files[0];
    };

    const saveAnnouncement = async (isEdit, itemId) => {
        if (!announcementForm.title.trim()) {
            throw new Error('Please enter an announcement title.');
        }

        if (!announcementForm.description.trim()) {
            throw new Error('Please enter an announcement description.');
        }

        const startDate = new Date(announcementForm.startDate || '');
        if (!announcementForm.startDate || Number.isNaN(startDate.getTime())) {
            throw new Error('Please choose a valid start date.');
        }

        if (announcementForm.endDate) {
            const endDate = new Date(announcementForm.endDate);
            if (Number.isNaN(endDate.getTime())) {
                throw new Error('Please choose a valid end date.');
            }

            if (endDate < startDate) {
                throw new Error('End date cannot be earlier than start date.');
            }
        }

        const formData = new FormData();
        formData.append('title', announcementForm.title);
        formData.append('description', announcementForm.description);
        formData.append('displayOrder', announcementForm.displayOrder || 1);
        formData.append('startDate', announcementForm.startDate || '');
        formData.append('endDate', announcementForm.endDate || '');
        formData.append('isActive', announcementForm.isActive !== false);
        formData.append('isImportant', announcementForm.isImportant === true);

        if (announcementImageFile.value) {
            formData.append('image', announcementImageFile.value);
        }

        try {
            if (isEdit) {
                await apiFetch(`/announcements/${itemId}`, {
                    method: 'PUT',
                    body: formData
                });
            } else {
                await apiFetch('/announcements', {
                    method: 'POST',
                    body: formData
                });
            }
            resetAnnouncementForm();
        } catch (error) {
            throw new Error(error.message || 'Failed to save announcement');
        }
    };

    const deleteAnnouncement = async (itemId) => {
        try {
            await apiFetch(`/announcements/${itemId}`, { method: 'DELETE' });
        } catch (error) {
            throw new Error(error.message || 'Failed to delete announcement');
        }
    };

    const loadAnnouncements = async () => {
        try {
            const response = await apiFetch('/announcements/admin/all');
            announcements.value = response.data || response;
        } catch (error) {
            console.error('Failed to load announcements:', error);
        }
    };

    return {
        announcements,
        announcementImageFile,
        nextDisplayOrder,
        nextDisplayOrderLoading,
        announcementForm,
        fetchNextDisplayOrder,
        resetAnnouncementForm,
        onImageUpload,
        saveAnnouncement,
        deleteAnnouncement,
        loadAnnouncements
    };
}
