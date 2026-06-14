<template>
    <section class="announcement-section">
        <div class="section-title" v-if="announcements.length > 0" style="text-align: center; margin-bottom: 3rem;">
            <span class="eyebrow">{{ t('components.announcementSlideshow.latestUpdates') }}</span>
            <h2 style="font-family: 'Fraunces', serif; font-size: clamp(2rem, 3vw, 2.5rem); margin: 0; color: #1a1a1a;">{{ t('components.announcementSlideshow.heading') }}</h2>
        </div>

        <!-- Horizontal Rotating Carousel -->
        <div v-if="showCarousel" class="carousel-container">
            <div class="carousel-track-wrapper"
                 @touchstart="handleTouchStart"
                 @touchend="handleTouchEnd"
                 @mousedown="handleTouchStart"
                 @mouseup="handleTouchEnd"
                 @mouseleave="handleTouchEnd">
                <div class="carousel-track" :style="getCarouselTransform()">
                    <div v-for="(announcement, index) in announcements" 
                         :key="'ann-' + index"
                         class="carousel-item"
                         :class="getItemClass(index)"
                         :style="getItemStyle(index)"
                         @click="handleCardClick(announcement, index)">
                        <div class="card">
                            <div v-if="announcement.imagePath || announcement.imageUrl" class="card-image">
                                <img :src="announcement.imagePath || announcement.imageUrl" :alt="announcement.title" loading="lazy" decoding="async">
                            </div>
                            <div class="card-overlay"></div>
                            <div class="card-content">
                                <span class="card-badge">{{ getTypeBadge(announcement) }}</span>
                                <h3>{{ announcement.title }}</h3>
                                <p>{{ truncateText(announcement.description, 80) }}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Navigation Dots -->
            <div class="carousel-dots">
                <button v-for="(announcement, index) in announcements" 
                        :key="index"
                        class="dot" 
                        :class="{ active: index === currentSlide }"
                        type="button"
                        :aria-label="t('components.announcementSlideshow.ariaLabelUpdate', { number: index + 1, title: announcement.title })"
                        :aria-current="index === currentSlide ? 'true' : null"
                        @click="goToSlide(index)">
                </button>
            </div>
        </div>

        <div v-else-if="announcements.length > 0" class="static-announcements-layout" :class="`count-${announcements.length}`">
            <div
                v-for="(announcement, index) in announcements"
                :key="'static-ann-' + index"
                class="static-announcement-card"
                :class="{ featured: announcements.length === 1 }"
                @click="handleStaticCardClick(announcement)"
            >
                <div class="card">
                    <div v-if="announcement.imagePath || announcement.imageUrl" class="card-image">
                        <img :src="announcement.imagePath || announcement.imageUrl" :alt="announcement.title" loading="lazy" decoding="async">
                    </div>
                    <div class="card-overlay"></div>
                    <div class="card-content">
                        <span class="card-badge">{{ getTypeBadge(announcement) }}</span>
                        <h3>{{ announcement.title }}</h3>
                        <p>{{ truncateText(announcement.description, 80) }}</p>
                    </div>
                </div>
            </div>
        </div>

        <div v-else class="no-announcements">
            <p>{{ t('components.announcementSlideshow.noAnnouncements') }}</p>
        </div>
<!-- Modal for Full Details -->
        <div v-if="selectedAnnouncement" class="announcement-modal-overlay" @click.self="closeModal">
            <div class="announcement-modal-content">
                <button class="close-btn" @click="closeModal"><i class="fa-solid fa-xmark"></i></button>
                <div v-if="selectedAnnouncement.imagePath || selectedAnnouncement.imageUrl" class="modal-image">
                    <img :src="selectedAnnouncement.imagePath || selectedAnnouncement.imageUrl" :alt="selectedAnnouncement.title" decoding="async">
                </div>
                <div class="modal-body">
                    <span class="card-badge" style="margin-bottom: 12px;">{{ getTypeBadge(selectedAnnouncement) }}</span>
                    <h2>{{ selectedAnnouncement.title }}</h2>
                    <p class="modal-desc">{{ selectedAnnouncement.description }}</p>
                </div>
            </div>
        </div>

    </section>
</template>

<script setup>
import { onMounted, ref, onBeforeUnmount, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiFetch } from '@/shared/client';
import { resolvePublicUploadUrl } from '@/shared/uploadUrls';

const announcements = ref([]);
const { t } = useI18n();
const currentSlide = ref(0);
const selectedAnnouncement = ref(null);
let autoSlideInterval = null;
let visibilityChangeHandler = null;
const showCarousel = computed(() => announcements.value.length >= 3);

const normalizeAnnouncement = (announcement) => ({
    kind: 'announcement',
    key: `announcement-${announcement._id || announcement.id || announcement.title || Math.random()}`,
    title: announcement.title || 'Barangay Announcement',
    description: announcement.description || '',
    imagePath: resolvePublicUploadUrl(announcement.imagePath || announcement.imageUrl || ''),
    displayDate: announcement.startDate || announcement.createdAt || '',
    isActive: announcement.isActive !== false,
    raw: announcement
});

const normalizeAdvisory = (advisory) => ({
    kind: 'advisory',
    key: `advisory-${advisory._id || advisory.id || advisory.disasterType || Math.random()}`,
    title: advisory.title || `${advisory.disasterType?.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) || 'Disaster'} Advisory`,
    description: advisory.advisoryMessage || advisory.description || '',
    imagePath: resolvePublicUploadUrl(advisory.imagePath || advisory.imageUrl || ''),
    displayDate: advisory.expectedImpactDate || advisory.createdAt || '',
    status: advisory.status || '',
    raw: advisory
});

const getTypeBadge = (item) => {
    if (item?.kind === 'advisory') {
        const statusLabel = String(item.status || 'ongoing').replaceAll('_', ' ');
        return `Advisory · ${statusLabel.replace(/\b\w/g, (letter) => letter.toUpperCase())}`;
    }

    return item?.isActive === false ? 'Announcement · Inactive' : 'Announcement · Active';
};

const mergeAndSortUpdates = (announcementsList, advisoriesList) => {
    const merged = [
        ...announcementsList.map(normalizeAnnouncement),
        ...advisoriesList.map(normalizeAdvisory)
    ];

    return merged.sort((left, right) => new Date(right.displayDate || 0).getTime() - new Date(left.displayDate || 0).getTime());
};

// Swipe logic variables
let touchStartX = 0;
let touchEndX = 0;

const handleTouchStart = (e) => {
    touchStartX = e.changedTouches ? e.changedTouches[0].screenX : e.screenX;
};

const handleTouchEnd = (e) => {
    touchEndX = e.changedTouches ? e.changedTouches[0].screenX : e.screenX;
    handleSwipeGesture();
};

const handleSwipeGesture = () => {
    const diff = touchStartX - touchEndX;
    // Require a minimum of 50px swipe distance
    if (Math.abs(diff) > 50) {
        if (diff > 0) {
            // Swiped left (next)
            nextSlide();
        } else {
            // Swiped right (previous)
            previousSlide();
        }
        startAutoSlide(); // Reset auto-slide timer after manual swipe
    }
};

const fetchAnnouncements = async () => {
    try {
        const [announcementResult, advisoryResult] = await Promise.allSettled([
            apiFetch('/announcements'),
            apiFetch('/disaster-advisories/public')
        ]);

        const announcementsList = announcementResult.status === 'fulfilled'
            ? (announcementResult.value.data || announcementResult.value || [])
            : [];
        const advisoriesList = advisoryResult.status === 'fulfilled'
            ? (advisoryResult.value.data || advisoryResult.value || [])
            : [];

        announcements.value = mergeAndSortUpdates(announcementsList, advisoriesList);
        currentSlide.value = 0;

        if (showCarousel.value) {
            startAutoSlide();
        } else {
            stopAutoSlide();
        }
    } catch (error) {
        console.error('Failed to fetch announcements:', error);
    }
};

const getCarouselTransform = () => {
    // Return empty transform because item-level transforms will handle all the sliding
    return {};
};

const getVisualIndex = (index) => {
    const total = announcements.value.length;
    if (total === 0) return 0;
    
    let dist = index - currentSlide.value;
    
    // If we only have 2 items, infinite loop is tricky, but let's handle standard >2 gracefully
    // Wrap around to create an infinite circle
    const half = Math.floor(total / 2);
    
    if (dist > half) {
        dist -= total;
    } else if (dist < -Math.round((total - 1) / 2)) {
        dist += total;
    }
    
    return dist;
};

const getItemStyle = (index) => {
    const dist = getVisualIndex(index);
    
    let scale = 1;
    let translateZ = '0px';
    let zIndex = 10;
    let opacity = 1;
    let filter = 'none';
    
    if (dist === 0) {
        // Center - default values already set above
    } else if (dist === 1 || dist === -1) {
        // Left or Right immediate sibling
        scale = 0.82;
        translateZ = '-200px';
        zIndex = 5;
        opacity = 0.72;
        filter = 'none';
    } else {
        // Hidden items
        scale = 0.75;
        translateZ = '-200px';
        zIndex = 1;
        opacity = 0;
        filter = 'none';
    }
    
    // Position entirely via `dist`
    // Negative dist goes Left, Positive dist goes Right
    // Subtract var(--card-width)/2 so it centers perfectly since track is left: 50%
    return {
        transform: `translateX(calc(${dist} * (var(--card-width) + var(--card-gap)) - (var(--card-width) / 2))) scale(${scale}) translateZ(${translateZ})`,
        opacity: opacity,
        filter: filter,
        zIndex: zIndex,
        pointerEvents: Math.abs(dist) <= 1 ? 'auto' : 'none',
        cursor: Math.abs(dist) <= 1 ? 'pointer' : 'default'
    };
};

const getItemClass = (index) => {
    const dist = getVisualIndex(index);
    if (dist === 0) return 'center';
    if (dist === 1) return 'right';
    if (dist === -1) return 'left';
    return 'hidden';
};

const handleCardClick = (announcement, index) => {
    const dist = getVisualIndex(index);
    if (dist === 0) {
        selectedAnnouncement.value = announcement;
        stopAutoSlide();
    } else if (Math.abs(dist) === 1) {
        goToSlide(index);
        startAutoSlide(); // restart inner interval
    }
};

const handleStaticCardClick = (announcement) => {
    selectedAnnouncement.value = announcement;
    stopAutoSlide();
};

const closeModal = () => {
    selectedAnnouncement.value = null;
    startAutoSlide();
};

const truncateText = (text, length) => {
    return text && text.length > length ? text.substring(0, length) + '...' : text;
};

const getStatusBadge = (isActive) => {
    return isActive ? 'Active' : 'Inactive';
};

const nextSlide = () => {
    currentSlide.value = (currentSlide.value + 1) % announcements.value.length;
};

const previousSlide = () => {
    currentSlide.value = (currentSlide.value - 1 + announcements.value.length) % announcements.value.length;
};

const goToSlide = (index) => {
    currentSlide.value = index;
};

const startAutoSlide = () => {
    if (!showCarousel.value || announcements.value.length < 3) {
        return;
    }

    if (autoSlideInterval) clearInterval(autoSlideInterval);
    autoSlideInterval = setInterval(() => {
        nextSlide();
    }, 3500);
};

const stopAutoSlide = () => {
    if (autoSlideInterval) clearInterval(autoSlideInterval);
};

let refreshInterval = null;
let isFetchPending = false;
let lastFetchTime = 0;
const FETCH_COOLDOWN = 5000; // 5 seconds minimum between fetches

onMounted(() => {
    fetchAnnouncements();

    refreshInterval = setInterval(() => {
        fetchAnnouncements();
    }, 30000);

    visibilityChangeHandler = () => {
        if (!document.hidden) {
            // Debounce: only fetch if last fetch was > 5 seconds ago and no request is pending
            const now = Date.now();
            if (!isFetchPending && (now - lastFetchTime) > FETCH_COOLDOWN) {
                lastFetchTime = now;
                isFetchPending = true;
                
                // Use Promise-based approach to prevent blocking
                fetchAnnouncements().finally(() => {
                    isFetchPending = false;
                });
            }
        }
    };

    globalThis.addEventListener('visibilitychange', visibilityChangeHandler);
});

onBeforeUnmount(() => {
    stopAutoSlide();

    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }

    if (visibilityChangeHandler) {
        globalThis.removeEventListener('visibilitychange', visibilityChangeHandler);
        visibilityChangeHandler = null;
    }
});
</script>

<style scoped>
.announcement-section {
    width: 100%;
    margin: 0;
}

.carousel-container {
    position: relative;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 15px;
    padding: 20px 0 80px 0;
    overflow: hidden;
}

.static-announcements-layout {
    width: 100%;
    display: grid;
    gap: 24px;
    padding: 20px 0 40px 0;
}

.static-announcements-layout.count-1 {
    grid-template-columns: minmax(0, 760px);
    justify-content: center;
}

.static-announcements-layout.count-2 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    max-width: 1120px;
    margin: 0 auto;
}

.static-announcement-card {
    height: 100%;
    min-height: 520px;
    cursor: pointer;
}

.static-announcement-card.featured {
    min-height: 580px;
    justify-self: center;
    width: 100%;
    max-width: 760px;
}

.static-announcement-card .card {
    height: 100%;
}

.static-announcement-card.featured .card-content h3 {
    font-size: 2.1rem;
}

.static-announcement-card.featured .card-content p {
    font-size: 1.15rem;
}

.carousel-track-wrapper {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    overflow: hidden;
    height: 600px;
    perspective: 1200px;
    position: relative;
    max-width: 100%;
    cursor: grab;
}

.carousel-track-wrapper:active {
    cursor: grabbing;
}

.carousel-track {
    --card-width: 550px;
    --card-gap: 40px;
    position: relative;
    left: 50%;
    width: 0;
    height: 560px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.carousel-item {
    position: absolute;
    left: 0;
    flex: 0 0 var(--card-width);
    width: var(--card-width);
    height: 560px;
    transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
    transform-origin: center center;
}

/* Center card, Left/Right cards, and Hidden items styles are applied
   via Vue inline binding in getItemStyle() to support infinite wrap-around */

.card {
    width: 100%;
    height: 100%;
    border-radius: 20px;
    background: white;
    box-shadow: 0 18px 42px rgba(19, 28, 24, 0.18), 0 6px 16px rgba(19, 28, 24, 0.08);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    cursor: pointer;
    transition: box-shadow 0.3s ease, transform 0.3s ease;
}

.carousel-item.center .card {
    box-shadow: 0 30px 80px rgba(19, 28, 24, 0.28), 0 10px 28px rgba(181, 0, 9, 0.12);
}

.carousel-item.left .card,
.carousel-item.right .card {
    box-shadow: 0 18px 48px rgba(19, 28, 24, 0.2), 0 6px 18px rgba(19, 28, 24, 0.1);
}

.card-image {
    width: 100%;
    height: 320px;
    overflow: hidden;
    background: linear-gradient(180deg, #f8f8f8, #ececec);
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
}

.card-image img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    object-position: center;
    display: block;
}

.card-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(135deg, rgba(255,255,255,0.1), rgba(0,0,0,0.05));
    pointer-events: none;
    z-index: 2;
}

.card-content {
    padding: 20px;
    display: flex;
    flex-direction: column;
    flex: 1;
    justify-content: space-between;
}

.card-badge {
    display: inline-block;
    padding: 4px 12px;
    background: linear-gradient(135deg, #d52a2a, #a41c1c);
    color: white;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.5px;
    width: fit-content;
    margin-bottom: 8px;
}

.card-content h3 {
    font-family: "Fraunces", serif;
    font-size: 1.8rem;
    color: #1a1a1a;
    margin: 0 0 10px 0;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.card-content p {
    font-size: 1.1rem;
    color: #5e6f66;
    margin: 0 0 16px 0;
    line-height: 1.5;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

/* CAROUSEL NAV BUTTONS REMOVED */

.carousel-dots {
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    justify-content: center;
    gap: 8px;
    width: 100%;
    padding-bottom: 20px;
}

.dot {
    border: none;
    width: 44px;
    height: 44px;
    padding: 0;
    background: transparent;
    cursor: pointer;
    display: inline-grid;
    place-items: center;
    transition: transform 0.2s ease;
}

.dot::before {
    content: '';
    width: 10px;
    height: 10px;
    border-radius: 999px;
    background: rgba(22, 36, 26, 0.2);
    transition: all 0.3s ease;
}

.dot.active::before {
    background: linear-gradient(135deg, #d52a2a, #a41c1c);
    width: 24px;
    border-radius: 6px;
}

.dot:hover::before,
.dot:focus-visible::before {
    background: rgba(22, 36, 26, 0.4);
}

.dot:focus-visible {
    outline: 2px solid rgba(164, 28, 28, 0.45);
    outline-offset: 2px;
}

.no-announcements {
    padding: 3rem 2rem;
    text-align: center;
    background: white;
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
    color: #5e6f66;
}

/* Modal Styles */
.announcement-modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(5px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    padding: 20px;
}

.announcement-modal-content {
    background: white;
    border-radius: 20px;
    width: 100%;
    max-width: 600px;
    max-height: 90vh;
    overflow-y: auto;
    position: relative;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
    animation: modalFadeIn 0.3s ease-out;
}

@keyframes modalFadeIn {
    from { opacity: 0; transform: translateY(20px) scale(0.95); }
    to { opacity: 1; transform: translateY(0) scale(1); }
}

.close-btn {
    position: absolute;
    top: 15px;
    right: 15px;
    background: rgba(0,0,0,0.5);
    color: white;
    border: none;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 10;
    transition: background 0.2s;
}

.close-btn:hover {
    background: rgba(0,0,0,0.8);
}

.modal-image {
    width: 100%;
    height: 300px;
    background: linear-gradient(180deg, #f8f8f8, #ececec);
    display: flex;
    align-items: center;
    justify-content: center;
}

.modal-image img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    object-position: center;
    display: block;
}

.modal-body {
    padding: 30px;
}

.modal-body h2 {
    font-family: "Fraunces", serif;
    font-size: 2rem;
    color: #1a1a1a;
    margin: 0 0 10px 0;
}

.modal-desc {
    color: #4a4a4a;
    font-size: 1.1rem;
    line-height: 1.6;
    white-space: pre-wrap;
}

/* Responsive */
@media (max-width: 1200px) {
    .carousel-track-wrapper {
        height: 480px;
    }

    .carousel-container {
        gap: 12px;
        padding: 15px 0 70px 0;
    }

    .carousel-item {
        flex: 0 0 var(--card-width);
        width: var(--card-width);
        height: 440px;
    }

    .card-image {
        height: 220px;
    }

    .carousel-track {
        --card-width: 380px;
        --card-gap: 30px;
        height: 440px;
        gap: var(--card-gap);
    }
}

@media (max-width: 768px) {
    .static-announcements-layout.count-2 {
        grid-template-columns: 1fr;
        max-width: 100%;
    }

    .static-announcement-card,
    .static-announcement-card.featured {
        min-height: 320px;
        max-width: 100%;
    }

    .static-announcement-card.featured .card-content h3 {
        font-size: 1.25rem;
    }

    .static-announcement-card.featured .card-content p {
        font-size: 1rem;
    }

    .carousel-track-wrapper {
        height: 360px;
    }

    .carousel-container {
        gap: 0;
        padding: 10px 0 50px 0;
    }

    .carousel-item {
        flex: 0 0 var(--card-width);
        width: var(--card-width);
        height: 320px;
    }

    .carousel-track {
        --card-width: 220px;
        --card-gap: 20px;
        height: 320px;
        gap: var(--card-gap);
    }

    .carousel-dots {
        gap: 6px;
        padding-bottom: 10px;
    }

    .dot {
        width: 7px;
        height: 7px;
    }

    .dot.active {
        width: 18px;
    }

    .card-image {
        height: 160px;
    }

    .card-image img {
        object-fit: contain;
    }

    .card-content {
        padding: 12px;
    }

    .card-content h3 {
        font-size: 1.1rem;
    }

    /* Hide long description on mobile, let users click to see in Modal */
    .card-content p {
        display: none;
    }
}
</style>
