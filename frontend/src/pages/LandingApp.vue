<template>
    <LanguageSwitcher floating />
    <div class="page-shell landing-shell">
        <ToastPopup :message="toastMessage" :type="toastType" @close="clearToast" />

        <header class="landing-topbar">
            <div class="landing-topbar-inner">
                <BrandMark initials="BI" eyebrow="Management System" :title="t('common.barangayName')" />
                <nav class="landing-nav" :aria-label="t('common.mainNavigation')">
                    <a href="#home">{{ t('landing.nav.home') }}</a>
                    <a href="#announcements">{{ t('landing.nav.announcements') }}</a>
                    <a href="#vmg">{{ t('landing.nav.vmg') }}</a>
                    <a href="#services">{{ t('landing.nav.services') }}</a>
                    <a href="#officials">{{ t('landing.nav.officials') }}</a>
                    <a href="#location">{{ t('landing.nav.location') }}</a>
                    <button type="button" class="landing-auth-btn" @click="openModal('login')">
                        <i class="fa-solid fa-right-to-bracket"></i>
                        {{ t('landing.nav.login') }}
                    </button>
                    <button type="button" class="landing-auth-btn" @click="openModal('register')">
                        <i class="fa-solid fa-user-plus"></i>
                        {{ t('landing.nav.register') }}
                    </button>
                    <button v-if="pendingOtpEmail" type="button" class="landing-auth-btn pending-otp-btn" @click="resumeOtpVerification">
                        <i class="fa-solid fa-shield-halved"></i>
                        {{ t('landing.nav.continueOtp') }}
                    </button>
                </nav>
            </div>
        </header>

        <main class="landing-main" id="main-content">
            <section class="landing-hero" id="home">
                <div class="landing-hero-overlay"></div>
                <div class="landing-hero-content">
                    <span class="eyebrow light animate-section slide-up">{{ t('landing.hero.eyebrow') }}</span>
                    <h2 class="animate-section slide-up">{{ t('landing.hero.title') }}</h2>
                    <h3 class="animate-section slide-up">{{ t('landing.hero.subtitle') }}</h3>
                    <p class="animate-section slide-up">
                        {{ t('landing.hero.copy') }}
                    </p>
                </div>
            </section>

            <section class="landing-lower-grid" id="announcements">
                <AnnouncementSlideshow />
            </section>

            <!-- Vision / Mission / Goals Section -->
            <section class="landing-vmg-section animate-section slide-up" id="vmg">

                <div class="vmg-grid">
                    <article class="vmg-card animate-section slide-up">
                        <div class="vmg-card-bg"></div>
                        <div class="vmg-wave top"></div>
                        <div class="vmg-wave outer top"></div>
                        <div class="vmg-overlay"></div>
                        <div class="vmg-copy">
                            <h4>{{ t('common.ui.vision') }}</h4>
                            <p><strong>BARANGAY IRAWAN:</strong><br>A PROGRESSIVE AGRICULTURAL TRADING CENTER OF PALAWAN, DEMONSTRATING A CLEAN AND GREEN ENVIRONMENT, INHABITED BY A COMPASSIONATE AND EMPOWERED CITIZENRY UNDER A PARTICIPATORY AND ACCOUNTABLE GOVERNANCE.</p>
                        </div>
                        <div class="vmg-wave bottom"></div>
                        <div class="vmg-wave outer bottom"></div>
                    </article>

                    <article class="vmg-card animate-section slide-up">
                        <div class="vmg-card-bg"></div>
                        <div class="vmg-wave top"></div>
                        <div class="vmg-wave outer top"></div>
                        <div class="vmg-overlay"></div>
                        <div class="vmg-copy">
                            <h4>{{ t('common.ui.mission') }}</h4>
                            <p>{{ t('common.ui.missionStatement') }}</p>
                        </div>
                        <div class="vmg-wave bottom"></div>
                        <div class="vmg-wave outer bottom"></div>
                    </article>

                    <article class="vmg-card animate-section slide-up">
                        <div class="vmg-card-bg"></div>
                        <div class="vmg-wave top"></div>
                        <div class="vmg-wave outer top"></div>
                        <div class="vmg-overlay"></div>
                        <div class="vmg-copy">
                            <h4>{{ t('common.ui.goals') }}</h4>
                            <p>{{ t('common.ui.goalsStatement') }}</p>
                        </div>
                        <div class="vmg-wave bottom"></div>
                        <div class="vmg-wave outer bottom"></div>
                    </article>
                </div>
            </section>
            <section class="landing-services-section animate-section slide-up" id="services">
                <div class="landing-section-heading center">
                    <h3>{{ t('landing.sections.servicesTitle') }}</h3>
                    <p>{{ t('landing.sections.servicesCopy') }}</p>
                </div>

                <div class="landing-service-grid">
                    <component
                        v-for="service in services"
                        :is="service.action ? 'button' : 'article'"
                        :key="service.title"
                        :class="['landing-service-card animate-section slide-left', { 'is-clickable': service.action }]"
                        :type="service.action ? 'button' : null"
                        @click="service.action ? handleServiceClick(service) : null"
                    >
                        <div class="landing-service-icon">{{ service.icon }}</div>
                        <h4>{{ service.title }}</h4>
                        <p>{{ service.copy }}</p>
                        <span v-if="service.action" class="landing-service-cta">{{ t('landing.actions.requestOnline') }}</span>
                    </component>
                </div>
            </section>

            <section class="landing-officials-section animate-section slide-up" id="officials">
            <div class="landing-section-heading center">
                <h3>{{ t('landing.sections.officialsTitle') }}</h3>
                <p>{{ t('landing.sections.officialsCopy') }}</p>
            </div>

            <div v-if="officialsLoading" class="officials-loading">{{ t('landing.actions.loadingOfficials') }}</div>
            <div v-else-if="sortedOfficials.length === 0" class="empty-state">{{ t('common.noOfficials') }}</div>
            <div v-else class="officials-sections">
                <!-- Barangay Captain (Solo Row) -->
                <div class="officials-row captain-row">
                    <article v-for="official in sortedOfficials.filter(o => o.position === 'Barangay Captain')" :key="official._id" class="official-card animate-section slide-up">
                        <div class="official-avatar" :style="resolvePublicUploadUrl(official.picture) ? { backgroundImage: `url(${resolvePublicUploadUrl(official.picture)})` } : {}">
                            <span v-if="!resolvePublicUploadUrl(official.picture)">{{ getOfficialInitials(official) }}</span>
                        </div>
                        <div class="official-copy">
                            <strong>{{ official.name }}</strong>
                            <small>{{ official.position }}</small>
                        </div>
                    </article>
                </div>

                <!-- Secretary & Treasurer (Dual Row) -->
                <div class="officials-row dual-row">
                    <article v-for="official in sortedOfficials.filter(o => ['Barangay Secretary', 'Barangay Treasurer'].includes(o.position))" :key="official._id" class="official-card animate-section slide-up">
                        <div class="official-avatar" :style="resolvePublicUploadUrl(official.picture) ? { backgroundImage: `url(${resolvePublicUploadUrl(official.picture)})` } : {}">
                            <span v-if="!resolvePublicUploadUrl(official.picture)">{{ getOfficialInitials(official) }}</span>
                        </div>
                        <div class="official-copy">
                            <strong>{{ official.name }}</strong>
                            <small>{{ official.position }}</small>
                        </div>
                    </article>
                </div>

                <!-- Kagawads (3 Columns) -->
                <div class="officials-row kagawad-row">
                    <article v-for="official in sortedOfficials.filter(o => o.position === 'Barangay Kagawad')" :key="official._id" class="official-card animate-section slide-up">
                        <div class="official-avatar" :style="resolvePublicUploadUrl(official.picture) ? { backgroundImage: `url(${resolvePublicUploadUrl(official.picture)})` } : {}">
                            <span v-if="!resolvePublicUploadUrl(official.picture)">{{ getOfficialInitials(official) }}</span>
                        </div>
                        <div class="official-copy">
                            <strong>{{ official.name }}</strong>
                            <small>{{ official.position }}</small>
                        </div>
                    </article>
                </div>

                <!-- Other (Dynamic Columns) -->
                <div class="officials-row other-row">
                    <article v-for="official in sortedOfficials.filter(o => o.position === 'Other')" :key="official._id" class="official-card animate-section slide-up">
                        <div class="official-avatar" :style="resolvePublicUploadUrl(official.picture) ? { backgroundImage: `url(${resolvePublicUploadUrl(official.picture)})` } : {}">
                            <span v-if="!resolvePublicUploadUrl(official.picture)">{{ getOfficialInitials(official) }}</span>
                        </div>
                        <div class="official-copy">
                            <strong>{{ official.name }}</strong>
                            <small>{{ official.position }}</small>
                        </div>
                    </article>
                </div>
            </div>
            </section>

            <section class="landing-location-band" id="location" ref="locationBandRef">
                <div class="landing-location-inner">
                    <div class="landing-location-copy animate-section slide-up">
                        <span class="eyebrow">{{ t('landing.location.eyebrow') }}</span>
                        <h3>{{ t('landing.location.title') }}</h3>
                        <p>
                            {{ t('landing.location.copy') }}
                        </p>
                    </div>

                    <a
                        class="landing-map-link animate-section slide-up"
                        href="https://www.google.com/maps/search/?api=1&query=Barangay+Hall+Irawan+Puerto+Princesa+Palawan"
                        target="_blank"
                        rel="noopener noreferrer"
                        :aria-label="t('landing.location.openMapAriaLabel')"
                    >
                        <iframe
                            v-if="mapLoaded"
                            class="landing-map-frame"
                            src="https://maps.google.com/maps?q=Barangay%20Hall%20Irawan%20Puerto%20Princesa%20Palawan&z=16&output=embed"
                            loading="lazy"
                            referrerpolicy="no-referrer-when-downgrade"
                            :title="t('landing.location.mapTitle')"
                        ></iframe>
                        <div v-else class="landing-map-placeholder">
                            <span>{{ t('common.tapOpenMap') }}</span>
                        </div>
                        <div class="landing-map-overlay">
                            <span>{{ mapLoaded ? 'Open in Google Maps' : 'Load map' }}</span>
                            <i class="fa-solid fa-arrow-up-right-from-square"></i>
                        </div>
                    </a>
                </div>
            </section>
        </main>

        <footer class="landing-footer">
            <div class="landing-footer-inner">
                <div class="landing-footer-top">
                    <div class="landing-footer-brand">
                        <div class="brand-mark small">BI</div>
                        <div>
                            <strong>{{ t('common.barangayName') }}</strong>
                            <div class="fine-print landing-footer-note">{{ t('landing.hero.subtitle') }}</div>
                        </div>
                    </div>

                    <nav class="landing-footer-nav" :aria-label="t('common.footerNavigation')">
                        <a href="#home">{{ t('landing.nav.home') }}</a>
                        <a href="#announcements">{{ t('common.ui.announcement') }}</a>
                        <a href="#vmg">{{ t('landing.nav.vmg') }}</a>
                        <a href="#services">{{ t('landing.nav.services') }}</a>
                        <a href="#officials">{{ t('landing.nav.officials') }}</a>
                        <a href="#location">{{ t('landing.nav.location') }}</a>
                    </nav>
                </div>

                <div class="landing-footer-bottom">
                    <div class="landing-footer-contact">
                        <a href="tel:+639631064569" class="landing-footer-contact-item">
                            <i class="fa-solid fa-phone"></i>
                            <span>+63 963 106 4569</span>
                        </a>
                        <a href="mailto:barangayirawan@gmail.com" class="landing-footer-contact-item">
                            <i class="fa-solid fa-envelope"></i>
                            <span>barangayirawan@gmail.com</span>
                        </a>
                        <a href="https://www.facebook.com/barangay.irawan.2025" target="_blank" rel="noopener noreferrer" class="landing-footer-contact-item">
                            <i class="fa-brands fa-facebook"></i>
                            <span>Facebook</span>
                        </a>
                    </div>

                    <div class="fine-print landing-footer-note">{{ t('landing.footer.rights') }}</div>
                </div>
            </div>
        </footer>

        <div v-if="activeModal" class="auth-modal-backdrop" @click.self="closeModal">
            <div class="auth-modal-container" :class="{ 'is-register': activeModal === 'register', 'is-request': activeModal.startsWith('guest-') }">
                <button type="button" class="auth-modal-close" @click="closeModal"><i class="fa-solid fa-xmark"></i></button>

                <!-- Left Visual Panel -->
                <div class="auth-modal-visual">
                    <div class="visual-overlay"></div>
                    <div class="visual-content">
                        <BrandMark initials="BI" eyebrow="Barangay Irawan" :title="activeModal ? t(`landing.auth.${activeModal}.visualTitle`) : 'Resident Portal'" />
                        <div class="visual-text">
                            <h3>{{ getVisualTitle(activeModal) }}</h3>
                            <p>{{ getVisualCopy(activeModal) }}</p>
                        </div>
                    </div>
                </div>

                <!-- Right Form Panel -->
                <div class="auth-modal-form-area">
                    <div class="form-header">
                        <h2>{{ getModalTitle(activeModal) }}</h2>
                        <div class="auth-toggle" v-if="['login', 'register', 'forgot-password', 'reset-password'].includes(activeModal)">
                            <span class="toggle-text">
                                {{ getToggleText(activeModal) }}
                            </span>
                            <button type="button" class="toggle-link" @click="switchAuthMode">
                                {{ getToggleLabel(activeModal) }}
                            </button>
                        </div>
                        
                    </div>

                    <transition name="fade-slide" mode="out-in">
                        <div :key="activeModal" class="form-transition-wrapper">
                            <form v-if="activeModal === 'guest-report-request'" class="modern-form register-form guest-request-form" @submit.prevent="handleGuestReportRequest">
                                <div class="guest-request-banner">
                                    <i class="fa-solid fa-flag"></i>
                                    <div>
                                        <strong>{{ t('landing.auth.guestReport.bannerTitle') }}</strong>
                                        <p>{{ t('landing.auth.guestReport.bannerCopy') }}</p>
                                    </div>
                                </div>

                                <div class="two-col-grid">
                                    <div class="input-group">
                                        <label for="guest-report-type">{{ t('landing.formLabels.reportType') }}</label>
                                        <div class="custom-select">
                                            <select id="guest-report-type" v-model="guestReportForm.reportType" required>
                                                <option value="noise_complaint">{{ t('common.ui.noiseComplaint') }}</option>
                                                <option value="disturbance">{{ t('common.ui.disturbance') }}</option>
                                                <option value="sanitation">{{ t('common.ui.sanitation') }}</option>
                                                <option value="infrastructure">{{ t('common.ui.infrastructure') }}</option>
                                                <option value="public_safety">{{ t('common.ui.publicSafety') }}</option>
                                                <option value="other">{{ t('common.ui.other') }}</option>
                                            </select>
                                            <i class="fa-solid fa-chevron-down"></i>
                                        </div>
                                    </div>
                                    <div class="input-group">
                                        <label for="guest-report-priority">{{ t('landing.formLabels.priority') }}</label>
                                        <div class="custom-select">
                                            <select id="guest-report-priority" v-model="guestReportForm.priority" required>
                                                <option value="low">{{ t('common.ui.low') }}</option>
                                                <option value="medium">{{ t('common.ui.medium') }}</option>
                                                <option value="high">{{ t('common.ui.high') }}</option>
                                                <option value="emergency">{{ t('common.ui.emergency') }}</option>
                                            </select>
                                            <i class="fa-solid fa-chevron-down"></i>
                                        </div>
                                    </div>
                                </div>

                                <div class="input-group">
                                    <label for="guest-report-description">{{ t('landing.formLabels.description') }}</label>
                                    <textarea id="guest-report-description" v-model="guestReportForm.description" rows="4" :placeholder="t('landing.placeholders.describeIncident')" required></textarea>
                                </div>

                                <div class="two-col-grid">
                                    <div class="input-group">
                                        <label for="guest-report-location">{{ t('landing.nav.location') }}</label>
                                        <input id="guest-report-location" v-model="guestReportForm.locationText" type="text" :placeholder="t('landing.placeholders.incidentLocation')" required>
                                    </div>
                                    <div class="input-group">
                                        <label for="guest-report-incident-date">{{ t('landing.formLabels.incidentDate') }}</label>
                                        <input
                                            id="guest-report-incident-date"
                                            v-model="guestReportForm.incidentDate"
                                            type="date"
                                            :max="todayDate"
                                            @input="limitGuestIncidentDateToToday"
                                            @change="limitGuestIncidentDateToToday"
                                        >
                                    </div>
                                </div>

                                <div style="display: grid; gap: 8px; padding: 12px; border: 1px dashed #c7d1cc; border-radius: 8px;">
                                    <span style="font-weight: 600; color: #3a4e43;">{{ t('landing.formLabels.currentLocationOptional') }}</span>
                                    <button type="button" class="ghost-button" @click="captureGuestCurrentLocation" :disabled="guestLocatingPosition">
                                        {{ guestLocatingPosition ? t('landing.formLabels.gettingLocation') : t('landing.formLabels.useCurrentLocation') }}
                                    </button>
                                    <small style="color: #6b7f74; line-height: 1.5; background: rgba(58, 78, 67, 0.05); padding: 8px; border-radius: 4px;" v-html="t('landing.auth.guestReport.safariTip')"></small>
                                    <small v-if="guestHasCapturedCoordinates" style="color: #4f6b5d;">{{ t('landing.formLabels.pinnedLocation', { latitude: guestReportForm.locationLatitude, longitude: guestReportForm.locationLongitude, accuracy: guestReportForm.locationAccuracy || 'N/A' }) }}</small>
                                    <iframe
                                        v-if="guestReportMapEmbedUrl"
                                        :src="guestReportMapEmbedUrl"
                                        :title="t('landing.location.guestReportMapTitle')"
                                        style="width: 100%; height: 180px; border: 1px solid #dce6e1; border-radius: 8px;"
                                        loading="lazy"
                                        referrerpolicy="no-referrer-when-downgrade"
                                    ></iframe>
                                </div>

                                <label v-if="guestReportTypeConfig.requireProof">
                                    <span>{{ guestReportTypeConfig.proofLabel }}</span>
                                    <input type="file" accept="image/jpeg,image/png,image/jpg" multiple @change="handleGuestReportProofFiles" required>
                                </label>
                                <small class="fine-print">{{ UPLOAD_SIZE_NOTE }}</small>
                                <small v-if="guestReportProofFiles.length" style="color: #4f6b5d;">{{ t('landing.messages.filesSelected', { count: guestReportProofFiles.length }) }}</small>

                                <div class="two-col-grid">
                                    <div class="input-group">
                                        <label for="guest-report-first-name">{{ t('landing.formLabels.firstName') }}</label>
                                        <input id="guest-report-first-name" v-model="guestReportForm.firstName" type="text" required>
                                    </div>
                                    <div class="input-group">
                                        <label for="guest-report-last-name">{{ t('landing.formLabels.lastName') }}</label>
                                        <input id="guest-report-last-name" v-model="guestReportForm.lastName" type="text" required>
                                    </div>
                                </div>

                                <div class="two-col-grid">
                                    <div class="input-group">
                                        <label for="guest-report-contact">{{ t('landing.formLabels.contactNumber') }}</label>
                                        <input id="guest-report-contact" v-model="guestReportForm.contactNumber" type="tel" placeholder="09xxxxxxxxx" required>
                                    </div>
                                    <div class="input-group">
                                        <label for="guest-report-email">{{ t('landing.formLabels.gmailAddress') }}</label>
                                        <input id="guest-report-email" v-model="guestReportForm.email" type="email" placeholder="yourname@gmail.com" required>
                                    </div>
                                </div>

                                <div class="input-group">
                                    <label for="guest-report-address">{{ t('landing.formLabels.currentAddress') }}</label>
                                    <input id="guest-report-address" v-model="guestReportForm.address" type="text" :placeholder="t('common.ui.cityMunicipalityBarangay')" required>
                                </div>

                                <div class="input-group">
                                    <label class="checkbox-label">
                                        <input type="checkbox" v-model="guestReportForm.agreePrivacy"> {{ t('landing.formLabels.agreePrivacy') }} <a href="#" @click.prevent="showPrivacy(activeModal)">{{ t('landing.privacy.title') }}</a>
                                    </label>
                                </div>

                                <button type="submit" class="auth-submit-btn" :disabled="isGuestReportLoading || !guestReportForm.agreePrivacy">
                                    {{ isGuestReportLoading ? t('landing.auth.guestReport.submitting') : t('landing.auth.guestReport.submit') }} <i :class="isGuestReportLoading ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-paper-plane'"></i>
                                </button>
                            </form>

                            <form v-else-if="activeModal === 'guest-appointment-request'" class="modern-form register-form guest-request-form" @submit.prevent="handleGuestAppointmentRequest">
                                <div class="guest-request-banner">
                                    <i class="fa-solid fa-calendar-check"></i>
                                    <div>
                                        <strong>{{ t('landing.auth.guestAppointment.bannerTitle') }}</strong>
                                        <p>{{ t('landing.auth.guestAppointment.bannerCopy') }}</p>
                                    </div>
                                </div>

                                <div class="two-col-grid">
                                    <div class="input-group">
                                        <label for="guest-appointment-category">Appointment Category</label>
                                        <div class="custom-select">
                                            <select id="guest-appointment-category" v-model="guestAppointmentForm.category" required @change="handleGuestAppointmentCategoryChange">
                                                <option disabled value="">Select an appointment category</option>
                                                <option v-for="category in APPOINTMENT_CATEGORY_OPTIONS" :key="category.value" :value="category.value">{{ category.label }}</option>
                                            </select>
                                            <i class="fa-solid fa-chevron-down"></i>
                                        </div>
                                    </div>
                                    <div class="input-group">
                                        <label for="guest-appointment-official">{{ t('landing.formLabels.appointmentOfficial') }}</label>
                                        <div class="custom-select">
                                            <select id="guest-appointment-official" v-model="guestAppointmentForm.officialId" required :disabled="!guestAppointmentForm.category" @change="handleGuestAppointmentOfficialChange">
                                                <option disabled value="">{{ guestAppointmentForm.category ? t('common.ui.selectOfficial') : 'Select a category first' }}</option>
                                                <option v-for="official in guestAppointmentCategoryOfficials" :key="official._id" :value="official._id" :disabled="official.status !== 'active'">
                                                    {{ getGuestAppointmentOfficialLabel(official) }}
                                                </option>
                                            </select>
                                            <i class="fa-solid fa-chevron-down"></i>
                                        </div>
                                        <small v-if="guestAppointmentInactiveMessage" class="fine-print">{{ guestAppointmentInactiveMessage }}</small>
                                    </div>
                                    <div class="input-group">
                                        <label for="guest-appointment-date">{{ t('landing.formLabels.appointmentDate') }}</label>
                                        <input id="guest-appointment-date" v-model="guestAppointmentForm.appointmentDate" type="date" :min="getMinimumAppointmentDate()" required @change="loadGuestAppointmentSlots">
                                    </div>
                                </div>

                                <div class="facility-slot-picker" v-if="guestAppointmentForm.officialId && guestAppointmentForm.appointmentDate && !selectedGuestAppointmentOfficialInactive">
                                    <div class="facility-slot-head">
                                        <span>{{ t('landing.formLabels.availableTimeSlot') }}</span>
                                        <small>{{ guestAppointmentSlotsAvailable.length }} available</small>
                                    </div>
                                    <div v-if="isGuestAppointmentSlotsLoading" class="facility-slot-note">{{ t('common.ui.loadingAppointmentSchedule') }}</div>
                                    <div v-else-if="!guestAppointmentSlotsAvailable.length" class="facility-slot-note">{{ t('common.ui.noAppointmentSlots') }}</div>
                                    <div v-else class="input-group">
                                        <label for="guest-appointment-slot">{{ t('common.ui.timeSlot') }}</label>
                                        <div class="custom-select">
                                            <select id="guest-appointment-slot" v-model="guestAppointmentSelectedSlot" required @change="applyGuestAppointmentSlot">
                                                <option disabled value="">{{ t('landing.formLabels.timeSlotSelect') }}</option>
                                                <option v-for="slot in guestAppointmentSlotsAvailable" :key="`${slot.startTime}-${slot.endTime}`" :value="`${slot.startTime}|${slot.endTime}`">{{ slot.label || `${slot.startTime} - ${slot.endTime}` }}</option>
                                            </select>
                                            <i class="fa-solid fa-chevron-down"></i>
                                        </div>
                                    </div>
                                </div>

                                <div class="input-group">
                                    <label for="guest-appointment-purpose">{{ t('landing.formLabels.purpose') }}</label>
                                    <textarea id="guest-appointment-purpose" v-model="guestAppointmentForm.purpose" rows="3" :placeholder="t('landing.formLabels.purposeShort')" required></textarea>
                                </div>

                                <div class="two-col-grid">
                                    <div class="input-group">
                                        <label for="guest-appointment-first-name">{{ t('landing.formLabels.firstName') }}</label>
                                        <input id="guest-appointment-first-name" v-model="guestAppointmentForm.firstName" type="text" required>
                                    </div>
                                    <div class="input-group">
                                        <label for="guest-appointment-last-name">{{ t('landing.formLabels.lastName') }}</label>
                                        <input id="guest-appointment-last-name" v-model="guestAppointmentForm.lastName" type="text" required>
                                    </div>
                                </div>

                                <div class="two-col-grid">
                                    <div class="input-group">
                                        <label for="guest-appointment-contact">{{ t('landing.formLabels.contactNumber') }}</label>
                                        <input id="guest-appointment-contact" v-model="guestAppointmentForm.contactNumber" type="tel" placeholder="09xxxxxxxxx" required>
                                    </div>
                                    <div class="input-group">
                                        <label for="guest-appointment-email">{{ t('landing.formLabels.gmailAddress') }}</label>
                                        <input id="guest-appointment-email" v-model="guestAppointmentForm.email" type="email" placeholder="yourname@gmail.com" required>
                                    </div>
                                </div>

                                <div class="input-group">
                                    <label for="guest-appointment-address">{{ t('landing.formLabels.currentAddress') }}</label>
                                    <input id="guest-appointment-address" v-model="guestAppointmentForm.address" type="text" :placeholder="t('common.ui.cityMunicipalityBarangay')" required>
                                </div>

                                <div class="input-group">
                                    <label class="checkbox-label">
                                        <input type="checkbox" v-model="guestAppointmentForm.agreePrivacy"> {{ t('landing.formLabels.agreePrivacy') }} <a href="#" @click.prevent="showPrivacy(activeModal)">{{ t('landing.privacy.title') }}</a>
                                    </label>
                                </div>

                                <button type="submit" class="auth-submit-btn" :disabled="!canSubmitGuestAppointment">
                                    {{ isGuestAppointmentLoading ? t('landing.auth.guestAppointment.submitting') : t('landing.auth.guestAppointment.submit') }} <i :class="isGuestAppointmentLoading ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-paper-plane'"></i>
                                </button>
                            </form>

                            <form v-else-if="activeModal === 'guest-facility-request'" class="modern-form register-form guest-request-form" @submit.prevent="handleGuestReservationRequest">
                                <div class="guest-request-banner">
                                    <i class="fa-solid fa-building-circle-check"></i>
                                    <div>
                                        <strong>{{ t('landing.auth.guestReservation.bannerTitle') }}</strong>
                                        <p>{{ t('landing.auth.guestReservation.bannerCopy') }}</p>
                                    </div>
                                </div>

                                <div class="two-col-grid">
                                    <div class="input-group">
                                        <label for="guest-facility-name">{{ t('landing.formLabels.facilityType') }}</label>
                                        <div class="custom-select">
                                            <select id="guest-facility-name" v-model="guestReservationForm.facilityName" required @change="loadGuestFacilityAvailability">
                                                <option v-for="option in FACILITY_ITEM_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
                                            </select>
                                            <i class="fa-solid fa-chevron-down"></i>
                                        </div>
                                    </div>
                                    <div class="input-group">
                                        <label for="guest-facility-date">{{ t('landing.formLabels.reservationDate') }}</label>
                                            <input id="guest-facility-date" v-model="guestReservationForm.reservationDate" type="date" :min="getMinimumFacilityReservationDate()" required @change="loadGuestFacilityAvailability">
                                    </div>
                                </div>

                                <div class="facility-slot-picker" v-if="guestReservationForm.facilityName && guestReservationForm.reservationDate">
                                    <div class="facility-slot-head">
                                        <span>{{ t('landing.formLabels.facilityTimeSlot') }}</span>
                                        <small>Open {{ guestFacilityTimeOptions.operatingHoursLabel }}</small>
                                    </div>
                                    <div v-if="isGuestFacilityAvailabilityLoading" class="facility-slot-note">{{ t('common.ui.loadingFacilitySchedule') }}</div>
                                    <div v-else class="facility-slot-grid">
                                        <div class="input-group">
                                            <label for="guest-facility-start">{{ t('landing.formLabels.startTime') }}</label>
                                            <div class="custom-select">
                                                <select id="guest-facility-start" v-model="guestReservationForm.startTime" required @change="guestReservationForm.endTime = ''; loadGuestFacilityAvailabilityForTime()">
                                                    <option disabled value="">{{ t('common.ui.selectStart') }}</option>
                                                    <option v-for="slot in guestFacilityTimeOptions.startOptions" :key="slot.value" :value="slot.value" :disabled="slot.disabled">{{ slot.label }}</option>
                                                </select>
                                                <i class="fa-solid fa-chevron-down"></i>
                                            </div>
                                        </div>
                                        <div class="input-group">
                                            <label for="guest-facility-end">{{ t('landing.formLabels.endTime') }}</label>
                                            <div class="custom-select">
                                                <select id="guest-facility-end" v-model="guestReservationForm.endTime" required :disabled="!guestReservationForm.startTime" @change="loadGuestFacilityAvailabilityForTime()">
                                                    <option disabled value="">{{ t('common.ui.selectEnd') }}</option>
                                                    <option v-for="slot in guestFacilityTimeOptions.endOptions" :key="slot.value" :value="slot.value" :disabled="slot.disabled">{{ slot.label }}</option>
                                                </select>
                                                <i class="fa-solid fa-chevron-down"></i>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="facility-reserved-list" v-if="guestReservationInventoryPeakSummary">
                                        <span>{{ guestReservationInventoryPeakSummary.title }}</span>
                                        <small v-for="range in guestReservationInventoryPeakSummary.ranges" :key="`${range.type}-${range.start}-${range.end}`">{{ range.icon }} {{ range.rangeLabel }}: {{ range.message }}</small>
                                        <small>{{ guestReservationInventoryPeakSummary.note }}</small>
                                    </div>
                                    <div class="facility-reserved-list" v-else-if="guestFacilityTimeOptions.reservedSlots.length">
                                        <span>{{ t('landing.formLabels.reservedRanges') }}</span>
                                        <small v-for="slot in guestFacilityTimeOptions.reservedSlots" :key="slot.id || `${slot.startTime}-${slot.endTime}`">{{ formatFacilityRange(slot.startTime, slot.endTime) }} Reserved <span v-if="slot.facilityName">| {{ getFacilityItemLabel(slot.facilityName) }}</span> <span v-if="getFacilityReservationQuantity(slot) > 0">x{{ getFacilityReservationQuantity(slot) }}</span></small>
                                    </div>
                                    <!-- Standard flow helper text removed -->
                                </div>

                                <div class="input-group">
                                    <label for="guest-facility-purpose">{{ t('landing.formLabels.purpose') }}</label>
                                    <input id="guest-facility-purpose" v-model="guestReservationForm.purpose" type="text" placeholder="Wedding, meeting, celebration, etc." required>
                                </div>

                                    <div class="two-col-grid" v-if="guestReservationRequiresQuantity">
                                        <div class="input-group">
                                            <label for="guest-facility-quantity">{{ t('landing.formLabels.quantity') }}</label>
                                            <input id="guest-facility-quantity" v-model.number="guestReservationForm.quantity" type="number" min="1" :max="guestReservationQuantityMax" placeholder="0" :disabled="guestReservationInventoryUnavailable">
                                            <small v-if="guestReservationInventoryMessage" class="fine-print">{{ guestReservationInventoryMessage }}</small>
                                        </div>
                                    </div>

                                <div class="input-group">
                                    <label for="guest-facility-details">{{ t('landing.formLabels.reservationPurpose') }}</label>
                                    <textarea id="guest-facility-details" v-model="guestReservationForm.reservationDetails" rows="4" :placeholder="t('landing.formLabels.reservationDetails')"></textarea>
                                </div>

                                <div class="two-col-grid">
                                    <div class="input-group">
                                        <label for="guest-facility-first-name">{{ t('landing.formLabels.firstName') }}</label>
                                        <input id="guest-facility-first-name" v-model="guestReservationForm.firstName" type="text" required>
                                    </div>
                                    <div class="input-group">
                                        <label for="guest-facility-last-name">{{ t('landing.formLabels.lastName') }}</label>
                                        <input id="guest-facility-last-name" v-model="guestReservationForm.lastName" type="text" required>
                                    </div>
                                </div>

                                <div class="two-col-grid">
                                    <div class="input-group">
                                        <label for="guest-facility-contact">{{ t('landing.formLabels.contactNumber') }}</label>
                                        <input id="guest-facility-contact" v-model="guestReservationForm.contactNumber" type="tel" placeholder="09xxxxxxxxx" required>
                                    </div>
                                    <div class="input-group">
                                        <label for="guest-facility-email">{{ t('landing.formLabels.gmailAddress') }}</label>
                                        <input id="guest-facility-email" v-model="guestReservationForm.email" type="email" placeholder="yourname@gmail.com" required>
                                    </div>
                                </div>

                                <div class="input-group">
                                    <label for="guest-facility-address">{{ t('landing.formLabels.currentAddress') }}</label>
                                    <input id="guest-facility-address" v-model="guestReservationForm.address" type="text" :placeholder="t('common.ui.cityMunicipalityBarangay')" required>
                                </div>

                                <div class="input-group">
                                    <label class="checkbox-label">
                                        <input type="checkbox" v-model="guestReservationForm.agreePrivacy"> {{ t('landing.formLabels.agreePrivacy') }} <a href="#" @click.prevent="showPrivacy(activeModal)">{{ t('landing.privacy.title') }}</a>
                                    </label>
                                </div>

                                <button type="submit" class="auth-submit-btn" :disabled="!canSubmitGuestReservation">
                                    {{ isGuestReservationLoading ? t('landing.auth.guestReservation.submitting') : t('landing.auth.guestReservation.submit') }} <i :class="isGuestReservationLoading ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-paper-plane'"></i>
                                </button>
                            </form>

                            <!-- Login Form -->
                            <form v-if="activeModal === 'login'" class="modern-form" @submit.prevent="handleLogin">
                                <div class="input-group">
                                    <label for="login-username">{{ t('landing.auth.login.username') }}</label>
                                    <div class="input-wrapper">
                                        <i class="fa-regular fa-user"></i>
                                        <input id="login-username" name="username" v-model="loginForm.username" type="text" autocomplete="username" :placeholder="t('landing.auth.login.usernamePlaceholder')" required>
                                    </div>
                                </div>
                                <div class="input-group">
                                    <label for="login-password">{{ t('landing.auth.login.password') }}</label>
                                    <div class="input-wrapper has-toggle">
                                        <i class="fa-solid fa-lock"></i>
                                        <input id="login-password" name="password" v-model="loginForm.password" :type="passwordVisibility.login ? 'text' : 'password'" autocomplete="off" :placeholder="t('landing.auth.login.passwordPlaceholder')" required>
                                        <button
                                            type="button"
                                            class="password-toggle-btn"
                                            :aria-label="passwordVisibility.login ? 'Hide password' : 'Show password'"
                                            @click="togglePasswordVisibility('login')"
                                        >
                                            <i :class="passwordVisibility.login ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash'"></i>
                                        </button>
                                    </div>
                                </div>
                                <button type="submit" class="auth-submit-btn" :disabled="isLoginLoading">
                                    {{ isLoginLoading ? t('landing.auth.login.signingIn') : t('landing.auth.login.button') }} <i :class="isLoginLoading ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-arrow-right'"></i>
                                </button>
                                <button type="button" class="auth-secondary-btn" @click="openModal('forgot-password')">
                                    {{ t('landing.auth.login.forgot') }}
                                </button>
                            </form>

                            <!-- Registration Form -->
                            <form v-else-if="activeModal === 'register'" class="modern-form register-form" @submit.prevent="handleRegister">
                                <div class="section-head compact-head">
                                    <span class="eyebrow">{{ t('common.ui.section1') }}</span>
                                    <h4>{{ t('common.ui.personalInformation') }}</h4>
                                </div>
                                <div class="two-col-grid">
                                    <div :class="registerInputClass('firstName')">
                                        <label for="reg-firstname">{{ t('landing.formLabels.firstName') }} <span class="required-mark">*</span></label>
                                        <input id="reg-firstname" name="firstName" v-model="registerForm.firstName" type="text" autocomplete="given-name" placeholder="Juan" required :aria-invalid="hasRegisterError('firstName')">
                                        <p v-if="hasRegisterError('firstName')" class="field-error">{{ registerFieldErrors.firstName }}</p>
                                    </div>
                                    <div class="input-group">
                                        <label for="reg-middlename">{{ t('portal.profile.labels.middleName') }}</label>
                                        <input id="reg-middlename" name="middleName" v-model="registerForm.middleName" type="text" autocomplete="additional-name" placeholder="Santos">
                                    </div>
                                </div>
                                <div class="two-col-grid">
                                    <div :class="registerInputClass('lastName')">
                                        <label for="reg-lastname">{{ t('landing.formLabels.lastName') }} <span class="required-mark">*</span></label>
                                        <input id="reg-lastname" name="lastName" v-model="registerForm.lastName" type="text" autocomplete="family-name" placeholder="Dela Cruz" required :aria-invalid="hasRegisterError('lastName')">
                                        <p v-if="hasRegisterError('lastName')" class="field-error">{{ registerFieldErrors.lastName }}</p>
                                    </div>
                                    <div class="input-group">
                                        <label class="checkbox-label compact-checkbox">
                                            <input type="checkbox" v-model="registerHasSuffix">
                                            <span>{{ t('common.ui.hasSuffix') }}</span>
                                        </label>
                                        <input v-if="registerHasSuffix" id="reg-suffix" name="suffix" v-model="registerForm.suffix" type="text" placeholder="Jr., Sr., III">
                                    </div>
                                </div>
                                <div class="two-col-grid">
                                    <div :class="registerInputClass('sex')">
                                        <label for="reg-sex">{{ t('common.ui.gender') }} <span class="required-mark">*</span></label>
                                        <div class="custom-select">
                                            <select id="reg-sex" name="sex" v-model="registerForm.sex" required :aria-invalid="hasRegisterError('sex')">
                                                <option value="male">{{ t('common.ui.male') }}</option>
                                                <option value="female">{{ t('common.ui.female') }}</option>
                                            </select>
                                            <i class="fa-solid fa-chevron-down"></i>
                                        </div>
                                        <p v-if="hasRegisterError('sex')" class="field-error">{{ registerFieldErrors.sex }}</p>
                                    </div>
                                    <div :class="registerInputClass('birthDate')">
                                        <label for="reg-birthdate">{{ t('common.ui.birthDate') }} <span class="required-mark">*</span></label>
                                        <input id="reg-birthdate" name="birthDate" v-model="registerForm.birthDate" type="date" autocomplete="bday" required :min="oldestRegistrationBirthDate" :max="youngestRegistrationBirthDate" :aria-invalid="hasRegisterError('birthDate')">
                                        <p v-if="hasRegisterError('birthDate')" class="field-error">{{ registerFieldErrors.birthDate }}</p>
                                    </div>
                                </div>
                                <div class="two-col-grid">
                                    <div class="input-group">
                                        <label for="reg-civil-status">{{ t('portal.profile.labels.civilStatus') }}</label>
                                        <div class="custom-select">
                                            <select id="reg-civil-status" v-model="registerForm.civilStatus">
                                                <option value="single">{{ t('common.ui.single') }}</option>
                                                <option value="married">{{ t('common.ui.married') }}</option>
                                                <option value="widowed">{{ t('common.ui.widowed') }}</option>
                                                <option value="separated">{{ t('common.ui.separated') }}</option>
                                            </select>
                                            <i class="fa-solid fa-chevron-down"></i>
                                        </div>
                                    </div>
                                    <div class="input-group">
                                        <label for="reg-citizenship">{{ t('common.ui.citizenship') }}</label>
                                        <input id="reg-citizenship" v-model="registerForm.citizenship" type="text" :placeholder="t('language.filipino')">
                                    </div>
                                </div>
                                <div class="input-group">
                                    <label for="reg-occupation">{{ t('portal.profile.labels.occupation') }}</label>
                                    <input id="reg-occupation" v-model="registerForm.occupation" type="text" :placeholder="t('portal.profile.labels.occupation')">
                                </div>

                                <div class="section-head compact-head">
                                    <span class="eyebrow">{{ t('common.ui.section2') }}</span>
                                    <h4>{{ t('common.ui.contactAndAddress') }}</h4>
                                </div>
                                <div class="input-group">
                                    <label for="reg-address">{{ t('portal.profile.labels.barangay') }} <span class="required-mark">*</span></label>
                                    <input id="reg-address" name="address" v-model="registerForm.address" type="text" autocomplete="address-line1" readonly required>
                                </div>
                                <div class="two-col-grid">
                                    <div :class="registerInputClass('contactNumber')">
                                        <label for="reg-contact">{{ t('landing.formLabels.contactNumber') }} <span class="required-mark">*</span></label>
                                        <div class="phone-input-wrapper">
                                            <span class="phone-country-badge" aria-hidden="true">
                                                <span class="phone-country-flag">🇵🇭</span>
                                                <span>PH</span>
                                            </span>
                                            <input id="reg-contact" name="contactNumber" v-model="registerForm.contactNumber" type="tel" autocomplete="tel" inputmode="tel" placeholder="+639XXXXXXXXX" pattern="^(09\d{9}|\+639\d{9}|639\d{9})$" maxlength="13" required :aria-invalid="hasRegisterError('contactNumber')" @focus="ensureRegisterPhonePrefix" @input="formatRegisterPhoneInput">
                                        </div>
                                        <p v-if="hasRegisterError('contactNumber')" class="field-error">{{ registerFieldErrors.contactNumber }}</p>
                                    </div>
                                    <div :class="registerInputClass('email')">
                                        <label for="reg-email">{{ t('common.ui.emailAddress') }} <span class="required-mark">*</span></label>
                                        <input id="reg-email" name="email" v-model="registerForm.email" type="email" autocomplete="email" placeholder="juan@example.com" required :aria-invalid="hasRegisterError('email')">
                                        <p v-if="hasRegisterError('email')" class="field-error">{{ registerFieldErrors.email }}</p>
                                    </div>
                                </div>
                                <div class="two-col-grid">
                                    <div :class="registerInputClass('purok')">
                                        <label for="reg-purok">{{ t('portal.profile.labels.purok') }} <span class="required-mark">*</span></label>
                                        <div class="custom-select">
                                            <select id="reg-purok" name="purok" v-model="registerForm.purok" required :aria-invalid="hasRegisterError('purok')">
                                                <option value="" disabled>{{ t('common.ui.selectPurok') }}</option>
                                                <option v-for="purok in purokOptions" :key="purok" :value="purok">{{ purok }}</option>
                                            </select>
                                            <i class="fa-solid fa-chevron-down"></i>
                                        </div>
                                        <p v-if="hasRegisterError('purok')" class="field-error">{{ registerFieldErrors.purok }}</p>
                                    </div>
                                    <div v-if="availableZoneOptions.length" :class="registerInputClass('zone')">
                                        <label for="reg-zone">{{ t('portal.profile.labels.zone') }} <span class="required-mark">*</span></label>
                                        <div class="custom-select">
                                            <select id="reg-zone" name="zone" v-model="registerForm.zone" required :aria-invalid="hasRegisterError('zone')">
                                                <option value="" disabled>{{ t('common.ui.selectZone') }}</option>
                                                <option v-for="zone in availableZoneOptions" :key="zone" :value="zone">{{ zone }}</option>
                                            </select>
                                            <i class="fa-solid fa-chevron-down"></i>
                                        </div>
                                        <p v-if="hasRegisterError('zone')" class="field-error">{{ registerFieldErrors.zone }}</p>
                                    </div>
                                </div>

                                <div class="section-head compact-head">
                                    <span class="eyebrow">{{ t('common.ui.section3') }}</span>
                                    <h4>{{ t('portal.profile.accountInformationHeading') }}</h4>
                                </div>
                                <div :class="registerInputClass('username')">
                                    <label for="reg-username">{{ t('landing.auth.login.username') }} <span class="required-mark">*</span></label>
                                    <div class="input-wrapper">
                                        <i class="fa-regular fa-user"></i>
                                        <input id="reg-username" name="new-username" v-model="registerForm.username" type="text" autocomplete="username" :placeholder="t('common.ui.chooseUsername')" required :aria-invalid="hasRegisterError('username')">
                                    </div>
                                    <p v-if="hasRegisterError('username')" class="field-error">{{ registerFieldErrors.username }}</p>
                                </div>
                                <div class="two-col-grid">
                                    <div :class="registerInputClass('password')">
                                        <label for="reg-password">{{ t('landing.auth.login.password') }} <span class="required-mark">*</span></label>
                                        <div class="input-wrapper has-toggle">
                                            <i class="fa-solid fa-lock"></i>
                                            <input id="reg-password" name="new-password" v-model="registerForm.password" :type="passwordVisibility.register ? 'text' : 'password'" autocomplete="off" placeholder="Min. 8 characters" minlength="8" required :aria-invalid="hasRegisterError('password')">
                                            <button
                                                type="button"
                                                class="password-toggle-btn"
                                                :aria-label="passwordVisibility.register ? 'Hide password' : 'Show password'"
                                                @click="togglePasswordVisibility('register')"
                                            >
                                                <i :class="passwordVisibility.register ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash'"></i>
                                            </button>
                                        </div>
                                        <p v-if="hasRegisterError('password')" class="field-error">{{ registerFieldErrors.password }}</p>
                                    </div>
                                    <div :class="registerInputClass('confirmPassword')">
                                        <label for="reg-confirm">{{ t('common.confirmPassword') }} <span class="required-mark">*</span></label>
                                        <div class="input-wrapper has-toggle">
                                            <i class="fa-solid fa-lock"></i>
                                            <input id="reg-confirm" name="confirm-password" v-model="registerForm.confirmPassword" :type="passwordVisibility.registerConfirm ? 'text' : 'password'" autocomplete="off" :placeholder="t('common.ui.repeatPassword')" minlength="8" required :aria-invalid="hasRegisterError('confirmPassword')">
                                            <button
                                                type="button"
                                                class="password-toggle-btn"
                                                :aria-label="passwordVisibility.registerConfirm ? 'Hide password' : 'Show password'"
                                                @click="togglePasswordVisibility('registerConfirm')"
                                            >
                                                <i :class="passwordVisibility.registerConfirm ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash'"></i>
                                            </button>
                                        </div>
                                        <p v-if="hasRegisterError('confirmPassword')" class="field-error">{{ registerFieldErrors.confirmPassword }}</p>
                                    </div>
                                    <div class="password-rules" aria-live="polite">
                                        <p class="password-rules-title">{{ t('common.passwordMustInclude') }}</p>
                                        <ul class="password-rules-list">
                                            <li
                                                v-for="rule in registerPasswordRules"
                                                :key="rule.key"
                                                :class="['password-rule-item', rule.passed ? 'is-pass' : 'is-fail']"
                                            >
                                                <i :class="rule.passed ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle-xmark'"></i>
                                                <span>{{ rule.label }}</span>
                                            </li>
                                        </ul>
                                    </div>
                                </div>
                                <div class="section-head compact-head">
                                    <span class="eyebrow">{{ t('common.ui.section5') }}</span>
                                    <h4>{{ t('common.ui.verificationDocuments') }}</h4>
                                </div>
                                <div :class="['input-group', 'file-upload-group', { 'has-error': hasRegisterError('proofOfResidency') }]">
                                    <label for="reg-proof">{{ t('common.ui.proofOfResidencyDocument') }} <span class="required-mark">*</span></label>
                                    <div class="file-upload-wrapper">
                                        <input id="reg-proof" name="proofOfResidency" type="file" @change="handleFileUpload" accept="image/*,application/pdf" required class="file-input">
                                        <div class="upload-btn"><i class="fa-solid fa-cloud-arrow-up"></i> {{ t('common.ui.chooseFile') }}</div>
                                        <span class="file-name">{{ proofOfResidencyFile ? proofOfResidencyFile.name : 'No file chosen' }}</span>
                                    </div>
                                    <small class="fine-print">{{ UPLOAD_SIZE_NOTE }}</small>
                                    <p v-if="hasRegisterError('proofOfResidency')" class="field-error">{{ registerFieldErrors.proofOfResidency }}</p>
                                </div>

                                <div :class="['recaptcha-shell', { 'has-error': hasRegisterError('recaptcha') }]">
                                    <div id="g-recaptcha" class="recaptcha-container"></div>
                                    <p v-if="hasRegisterError('recaptcha')" class="field-error">{{ registerFieldErrors.recaptcha }}</p>
                                </div>
                                <div class="legal-text">
                                    {{ t('common.ui.protectedByRecaptcha') }}
                                    <a href="https://policies.google.com/privacy" target="_blank">{{ t('landing.privacy.title') }}</a> {{ t('common.ui.and') }}
                                    <a href="https://policies.google.com/terms" target="_blank">{{ t('common.ui.termsOfService') }}</a>.
                                </div>
                                
                                <div class="input-group">
                                    <label class="checkbox-label privacy-consent-label">
                                        <input type="checkbox" v-model="registerForm.agreePrivacy">
                                        <span>{{ t('landing.auth.register.privacy') }} <a href="#" @click.prevent="showPrivacy(activeModal)">{{ t('landing.privacy.title') }}</a></span>
                                    </label>
                                </div>

                                <button type="submit" class="auth-submit-btn" :disabled="isRegisterLoading || !registerForm.agreePrivacy">
                                    {{ isRegisterLoading ? t('landing.auth.register.submitting') : t('landing.auth.register.submit') }} <i :class="isRegisterLoading ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-user-plus'"></i>
                                </button>
                            </form>

                            <!-- OTP Form -->
                            <form v-else-if="activeModal === 'otp'" class="modern-form otp-form" @submit.prevent="handleVerifyOtp">
                                <p class="otp-instruction">{{ t('landing.auth.otp.instruction') }}</p>
                                <div class="input-group">
                                    <label for="otp-email">{{ t('common.ui.emailAddress') }}</label>
                                    <input id="otp-email" name="email" v-model="otpForm.email" type="email" autocomplete="email" required placeholder="juan@example.com">
                                </div>
                                <div class="input-group">
                                    <label for="otp-code">{{ t('common.ui.otpCode') }}</label>
                                    <input id="otp-code" name="otp" v-model="otpForm.code" type="text" autocomplete="one-time-code" required maxlength="6" class="otp-input" placeholder="• • • • • •">
                                </div>
                                <button type="submit" class="auth-submit-btn" :disabled="isOtpLoading">
                                    {{ isOtpLoading ? 'Verifying...' : 'Verify Email' }} <i :class="isOtpLoading ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-check'"></i>
                                </button>
                                <button type="button" class="auth-secondary-btn" @click="handleResendOtp" :disabled="isResendOtpLoading || isOtpLoading">
                                    {{ isResendOtpLoading ? 'Resending...' : 'Resend OTP' }}
                                </button>
                                <button type="button" class="auth-secondary-btn" @click="activeModal = 'login'" :disabled="isOtpLoading">
                                    {{ t('landing.auth.otp.cancel') }}
                                </button>
                            </form>

                            <form v-else-if="activeModal === 'forgot-password'" class="modern-form" @submit.prevent="handleForgotPassword">
                                <p class="otp-instruction">
                                    {{ t('landing.auth.forgot.instruction') }}
                                </p>
                                <div class="input-group">
                                    <label for="forgot-email">{{ t('common.ui.emailAddress') }}</label>
                                    <input id="forgot-email" name="email" v-model="forgotPasswordForm.email" type="email" autocomplete="email" required placeholder="juan@example.com">
                                </div>
                                <button type="submit" class="auth-submit-btn">
                                    {{ forgotPasswordLoading ? 'Sending...' : 'Send Reset Link' }} <i class="fa-solid fa-paper-plane"></i>
                                </button>
                                <button type="button" class="auth-secondary-btn" @click="activeModal = 'login'" :disabled="forgotPasswordLoading">
                                    {{ t('admin.emailConfirm.back') }}
                                </button>
                            </form>

                            <form v-else-if="activeModal === 'reset-password'" class="modern-form" @submit.prevent="handleResetPassword">
                                <p class="otp-instruction">
                                    {{ t('common.ui.resetPasswordHelp') }}
                                </p>
                                <div class="input-group">
                                    <label for="reset-email">{{ t('common.ui.emailAddress') }}</label>
                                    <input id="reset-email" name="email" v-model="resetPasswordForm.email" type="email" autocomplete="email" required placeholder="juan@example.com">
                                </div>
                                <div class="two-col-grid">
                                    <div class="input-group">
                                        <label for="reset-password">{{ t('common.newPassword') }}</label>
                                        <div class="input-wrapper has-toggle">
                                            <i class="fa-solid fa-lock"></i>
                                            <input id="reset-password" name="password" v-model="resetPasswordForm.password" :type="passwordVisibility.reset ? 'text' : 'password'" autocomplete="off" :placeholder="t('common.ui.newPassword')" minlength="8" required>
                                            <button
                                                type="button"
                                                class="password-toggle-btn"
                                                :aria-label="passwordVisibility.reset ? 'Hide password' : 'Show password'"
                                                @click="togglePasswordVisibility('reset')"
                                            >
                                                <i :class="passwordVisibility.reset ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash'"></i>
                                            </button>
                                        </div>
                                    </div>
                                    <div class="input-group">
                                        <label for="reset-confirm">{{ t('common.confirmPassword') }}</label>
                                        <div class="input-wrapper has-toggle">
                                            <i class="fa-solid fa-lock"></i>
                                            <input id="reset-confirm" name="confirm-password" v-model="resetPasswordForm.confirmPassword" :type="passwordVisibility.resetConfirm ? 'text' : 'password'" autocomplete="off" :placeholder="t('common.ui.repeatPassword')" minlength="8" required>
                                            <button
                                                type="button"
                                                class="password-toggle-btn"
                                                :aria-label="passwordVisibility.resetConfirm ? 'Hide password' : 'Show password'"
                                                @click="togglePasswordVisibility('resetConfirm')"
                                            >
                                                <i :class="passwordVisibility.resetConfirm ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash'"></i>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <div class="password-rules" aria-live="polite">
                                    <p class="password-rules-title">{{ t('common.passwordMustInclude') }}</p>
                                    <ul class="password-rules-list">
                                        <li
                                            v-for="rule in resetPasswordRules"
                                            :key="rule.key"
                                            :class="['password-rule-item', rule.passed ? 'is-pass' : 'is-fail']"
                                        >
                                            <i :class="rule.passed ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle-xmark'"></i>
                                            <span>{{ rule.label }}</span>
                                        </li>
                                    </ul>
                                </div>
                                <button type="submit" class="auth-submit-btn">
                                    {{ resetPasswordLoading ? 'Updating...' : 'Update Password' }} <i class="fa-solid fa-key"></i>
                                </button>
                                <button type="button" class="auth-secondary-btn" @click="activeModal = 'login'" :disabled="resetPasswordLoading">
                                    {{ t('admin.emailConfirm.back') }}
                                </button>
                            </form>

                            <div v-else-if="activeModal === 'pending-approval'" class="modern-form pending-approval-view">
                                <div class="pending-status-icon">
                                    <i class="fa-solid fa-clock-rotate-left"></i>
                                </div>
                                <p class="otp-instruction">
                                    <span v-html="t('landing.auth.pending.verifiedMessage')"></span>
                                </p>
                                <div class="pending-info-card">
                                    <p><i class="fa-solid fa-info-circle"></i> {{ t('common.ui.registrationReview') }}</p>
                                    <p><i class="fa-solid fa-envelope"></i> {{ t('common.ui.approvalEmailNotice') }}</p>
                                </div>
                                <button type="button" class="auth-submit-btn" @click="closeModal">
                                    {{ t('common.ui.backToHomepage') }} <i class="fa-solid fa-house"></i>
                                </button>
                            </div>

                            <!-- Privacy Policy Modal -->
                            <div v-else-if="activeModal === 'privacy'" class="modern-form privacy-policy-view">
                                <div class="privacy-header">
                                    <h2>{{ t('landing.privacy.title') }}</h2>
                                    <button type="button" class="privacy-close-btn" @click="closeModal">
                                        <i class="fa-solid fa-xmark"></i>
                                    </button>
                                </div>

                                <div class="privacy-content">
                                    <section class="privacy-section">
                                        <h3>{{ t('landing.privacy.sections.introduction.heading') }}</h3>
                                        <p>{{ t('landing.privacy.sections.introduction.copy') }}</p>
                                    </section>

                                    <section class="privacy-section">
                                        <h3>{{ t('landing.privacy.sections.informationWeCollect.heading') }}</h3>
                                        <p>{{ t('landing.privacy.sections.informationWeCollect.copy') }}</p>
                                        <ul>
                                            <li><strong>{{ t('common.ui.personalData') }}</strong> {{ t('common.ui.personalDataList') }}</li>
                                        </ul>
                                    </section>

                                    <section class="privacy-section">
                                        <h3>{{ t('landing.privacy.sections.howWeUse.heading') }}</h3>
                                        <p>{{ t('landing.privacy.sections.howWeUse.copy') }}</p>
                                        <ul>
                                            <li>{{ t('common.ui.processDocuments') }}</li>
                                            <li>{{ t('common.ui.manageBookings') }}</li>
                                            <li>{{ t('common.ui.handleReports') }}</li>
                                            <li>{{ t('common.ui.communicateUpdates') }}</li>
                                            <li>{{ t('common.ui.improveExperience') }}</li>
                                            <li>{{ t('common.ui.legalCompliance') }}</li>
                                        </ul>
                                    </section>

                                    <section class="privacy-section">
                                        <h3>{{ t('common.ui.dataProtectionHeading') }}</h3>
                                        <p>{{ t('landing.privacy.sections.security.copy') }}</p>
                                    </section>

                                    <section class="privacy-section">
                                        <h3>{{ t('landing.privacy.sections.yourRights.heading') }}</h3>
                                        <p>{{ t('common.ui.rightsLead') }} <strong>barangayirawan@gmail.com</strong> {{ t('common.ui.exerciseRights') }}</p>
                                    </section>

                                    <section class="privacy-section">
                                        <h3>{{ t('landing.privacy.sections.contactUs.heading') }}</h3>
                                        <p>{{ t('landing.privacy.sections.contactUs.copy') }}</p>
                                        <p><strong>{{ t('common.barangayName') }}</strong><br>Email: barangayirawan@gmail.com<br>Phone: +63 963 106 4569</p>
                                    </section>

                                    <section class="privacy-section privacy-last">
                                        <p class="privacy-updated">{{ t('landing.privacy.lastUpdated') }}</p>
                                    </section>
                                </div>

                                <div class="privacy-footer">
                                    <button type="button" class="auth-submit-btn" @click="openModal('register')">
                                        {{ t('landing.privacy.iUnderstand') }} <i class="fa-solid fa-check"></i>
                                    </button>
                                </div>
                            </div>
                            
                            <!-- Privacy Overlay (preserve underlying modal DOM) -->
                            <div v-if="privacyOverlay" class="modern-form privacy-policy-view privacy-overlay">
                                <div class="privacy-header">
                                    <h2>{{ t('landing.privacy.title') }}</h2>
                                </div>

                                <div class="privacy-content">
                                    <section class="privacy-section">
                                        <h3>{{ t('landing.privacy.sections.introduction.heading') }}</h3>
                                        <p>Barangay Irawan ("we," "us," "our," or "the Barangay") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our Barangay Management System.</p>
                                    </section>

                                    <section class="privacy-section">
                                        <h3>{{ t('landing.privacy.sections.informationWeCollect.heading') }}</h3>
                                        <p>{{ t('landing.privacy.sections.informationWeCollect.copy') }}</p>
                                        <ul>
                                            <li><strong>{{ t('common.ui.personalData') }}</strong> {{ t('common.ui.personalDataList') }}</li>
                                        </ul>
                                    </section>

                                    <section class="privacy-section">
                                        <h3>{{ t('landing.privacy.sections.howWeUse.heading') }}</h3>
                                        <p>{{ t('landing.privacy.sections.howWeUse.copy') }}</p>
                                        <ul>
                                            <li>{{ t('common.ui.processDocuments') }}</li>
                                            <li>{{ t('common.ui.manageBookings') }}</li>
                                            <li>{{ t('common.ui.handleReports') }}</li>
                                            <li>{{ t('common.ui.communicateUpdates') }}</li>
                                            <li>{{ t('common.ui.improveExperience') }}</li>
                                            <li>{{ t('common.ui.legalCompliance') }}</li>
                                        </ul>
                                    </section>

                                    <section class="privacy-section">
                                        <h3>{{ t('common.ui.dataProtectionHeading') }}</h3>
                                        <p>{{ t('landing.privacy.sections.security.copy') }}</p>
                                    </section>

                                    <section class="privacy-section">
                                        <h3>{{ t('landing.privacy.sections.yourRights.heading') }}</h3>
                                        <p>{{ t('common.ui.rightsLead') }} <strong>barangayirawan@gmail.com</strong> {{ t('common.ui.exerciseRights') }}</p>
                                    </section>

                                    <section class="privacy-section">
                                        <h3>{{ t('landing.privacy.sections.contactUs.heading') }}</h3>
                                        <p>{{ t('landing.privacy.sections.contactUs.copy') }}</p>
                                        <p><strong>{{ t('common.barangayName') }}</strong><br>Email: barangayirawan@gmail.com<br>Phone: +63 963 106 4569</p>
                                    </section>

                                    <section class="privacy-section privacy-last">
                                        <p class="privacy-updated">{{ t('landing.privacy.lastUpdated') }}</p>
                                    </section>
                                </div>

                                <div class="privacy-footer">
                                    <button type="button" class="auth-submit-btn" @click.prevent="hidePrivacyOverlay">
                                        {{ t('landing.privacy.iUnderstand') }} <i class="fa-solid fa-check"></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </transition>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import BrandMark from '@/components/BrandMark.vue';
import LanguageSwitcher from '@/components/LanguageSwitcher.vue';
import AnnouncementSlideshow from '@/components/AnnouncementSlideshow.vue';
import ToastPopup from '@/components/ToastPopup.vue';
import { apiFetch } from '@/shared/client';
import { resolvePublicUploadUrl } from '@/shared/uploadUrls';
import { buildFacilityInventoryPeakSummary, buildFacilityTimeOptions, formatFacilityRange, FACILITY_ITEM_OPTIONS, getFacilityItemLabel, getFacilityReservationQuantity, getMinimumFacilityReservationDate, getFacilityItemOption } from '@/shared/facilityTimeSlots';
import { REPORT_TYPE_CONFIG } from '@/shared/reportTypeConfig';
import { APPOINTMENT_CATEGORY_OPTIONS, filterOfficialsByAppointmentCategory, getMinimumAppointmentDate } from '@/shared/appointmentCategories';
import { UPLOAD_SIZE_NOTE, getFileSizeError, getFilesSizeError } from '@/shared/uploadLimits';
import { getPasswordRequirementRules, isStrongPassword } from '@/shared/passwordRules';
import { localizeFeedbackMessage } from '@/shared/localizedFeedback';
import { useLandingAuth } from '@/composables/useLandingAuth';
import { useRecaptcha } from '@/composables/useRecaptcha';
import { usePasswordReset } from '@/composables/usePasswordReset';

// Composables
const { loginForm, registerForm, proofOfResidencyFile, otpForm, loginResident, registerResident, verifyOtp, resendOtp, handleFileUpload: setProofOfResidencyFile, getPendingOtpEmail, setPendingOtpEmail, clearPendingOtpEmail } = useLandingAuth();
const { recaptchaReady, ensureRecaptchaReady, renderRecaptchaCheckbox, getRecaptchaToken, resetRecaptcha, cleanupRecaptchaWidget } = useRecaptcha();
const { forgotPasswordForm, resetPasswordForm, forgotPasswordLoading, resetPasswordLoading, hydrateResetPasswordFromUrl, requestPasswordReset, submitPasswordReset } = usePasswordReset();

const landingText = {
    nav: { home: 'Home', vmg: 'VMG', services: 'Services', officials: 'Officials', announcements: 'Announcement', location: 'Location', appointments: 'Appointments', facilities: 'Facilities', login: 'Login', register: 'Register', continueOtp: 'Continue OTP' },
    hero: { eyebrow: 'Barangay Digital Services', title: 'Welcome to Barangay Irawan', subtitle: 'Puerto Princesa City', copy: 'Your gateway to efficient, modern barangay services. Access documents, schedule appointments, report incidents, and stay connected with your community, all in one place.' },
    sections: { servicesTitle: 'Barangay Services', servicesCopy: 'Everything you need to connect with Barangay Irawan and access essential community services.', officialsTitle: 'Barangay Officials', officialsCopy: 'Meet the leaders and public servants helping Barangay Irawan deliver faster, clearer services.', announcementsTitle: 'Announcement', announcementsCopy: 'Stay informed with the latest barangay updates, reminders, and emergency advisories.' },
    actions: { requestOnline: 'Request online', loadingOfficials: 'Loading officials...' },
    footer: { rights: '© 2026 Barangay Irawan. All rights reserved.' },
    auth: {
        login: { title: 'Resident Login', visualTitle: 'Welcome Back!', visualCopy: 'Access your digital barangay services, view announcements, and manage requests seamlessly.', username: 'Username or Email', password: 'Password', usernamePlaceholder: 'Enter your username or email', passwordPlaceholder: 'Enter your password', button: 'Login to Portal', signingIn: 'Signing in...', forgot: 'Forgot password?', toggleNoAccount: "Don't have an account?", toggleLabel: 'Create an account' },
        register: { title: 'Resident Registration', visualTitle: 'Join Our Community', visualCopy: 'Create an account to streamline your appointments, reports, and facility submissions.', submit: 'Submit Registration', submitting: 'Submitting...', toggleHaveAccount: 'Already have an account?', toggleLabel: 'Log in here', privacy: 'I agree to the', passwordRules: 'Password must include:' },
        otp: { title: 'Email Verification', visualTitle: 'Verify Your Email', visualCopy: 'We need to verify your email to secure your resident account.', instruction: 'We\'ve sent a 6-digit verification code to your email. Check your inbox (or spam folder).', verify: 'Verify Email', verifying: 'Verifying...', resend: 'Resend OTP', resending: 'Resending...', cancel: 'Cancel & Go to Login' },
        forgot: { title: 'Forgot Password', visualTitle: 'Reset Access Safely', visualCopy: 'We will send a secure reset link to the email address attached to your account.', instruction: 'Enter the email address linked to your account. We will send a reset link if it exists.', button: 'Send Reset Link', sending: 'Sending...' },
        reset: { title: 'Reset Password', visualTitle: 'Choose a New Password', visualCopy: 'Set a new password to restore access to your resident portal.', instruction: 'Choose a strong new password to restore access to your account.', button: 'Save New Password', saving: 'Saving...' },
        pending: { title: 'Registration Received', visualTitle: 'Account Pending Approval', visualCopy: 'Your registration has been verified and is now being reviewed by the Barangay Admin.' },
        guestReport: { title: 'Non-Resident Incident Report', visualTitle: 'Report Without Registration', visualCopy: 'Non-residents may file incident reports or community concerns. The admin will review the report and respond by email.', bannerTitle: 'Non-Resident Report', bannerCopy: 'Submit an incident report, complaint, or community concern. The admin will review it and email the update.', submit: 'Submit Report', submitting: 'Submitting...' },
        guestAppointment: { title: 'Non-Resident Appointment Request', visualTitle: 'Appoint Without Registration', visualCopy: 'Non-residents may request an appointment with an available barangay official. The admin will review the request and respond by email.', bannerTitle: 'Non-Resident Appointment', bannerCopy: 'Choose an active official and available time slot. The barangay admin will confirm your appointment by email.', submit: 'Submit Appointment', submitting: 'Submitting...' },
        guestReservation: { title: 'Non-Resident Facility Request', visualTitle: 'Reserve Without Registration', visualCopy: 'Non-residents may submit facility reservations. The barangay admin will review your request and contact you by email.', bannerTitle: 'Non-Resident Facility Request', bannerCopy: 'Reserve a barangay facility for your event. The admin will confirm availability and send an update by email.', submit: 'Submit Request', submitting: 'Submitting...' }
    }
};

const texts = ref({ landing: landingText });

const formatLocalDateInputValue = (date = new Date()) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const todayDate = formatLocalDateInputValue();
const registrationBirthDateLimit = (yearsAgo) => {
    const date = new Date();
    date.setFullYear(date.getFullYear() - yearsAgo);
    return formatLocalDateInputValue(date);
};
const oldestRegistrationBirthDate = registrationBirthDateLimit(120);
const youngestRegistrationBirthDate = registrationBirthDateLimit(18);

const limitGuestIncidentDateToToday = () => {
    if (guestReportForm.incidentDate && guestReportForm.incidentDate > todayDate) {
        guestReportForm.incidentDate = todayDate;
        setStatus('Date cannot be in the future.', true);
    }
};

const { t, locale } = useI18n();

// Local state
const activeModal = ref('');
const toastMessage = ref('');
const toastType = ref('success');
let toastTimer = null;
const pendingOtpEmail = ref(getPendingOtpEmail());
const purokOptions = ['Magsasaka', 'Sampalok', 'Masagana', 'Acacia', 'Freedom', 'Visapa'];
const zoneOptionsByPurok = {
    Sampalok: ['Zone 1', 'Zone 2', 'Zone 3', 'Zone 4'],
    Acacia: Array.from({ length: 10 }, (_, index) => `Zone ${index + 5}`)
};
const availableZoneOptions = computed(() => zoneOptionsByPurok[registerForm.purok] || []);

watch(() => registerForm.purok, () => {
    registerForm.zone = '';
});

registerForm.address = 'Barangay Irawan';
if (!registerForm.contactNumber) {
    registerForm.contactNumber = '+63';
}

const ensureRegisterPhonePrefix = () => {
    if (!String(registerForm.contactNumber || '').trim()) {
        registerForm.contactNumber = '+63';
    }
};

const formatRegisterPhoneInput = () => {
    let value = String(registerForm.contactNumber || '').replace(/[^\d+]/g, '');

    if (value.startsWith('+63')) {
        registerForm.contactNumber = `+63${value.slice(3).replace(/\D/g, '').slice(0, 10)}`;
        return;
    }

    const digits = value.replace(/\D/g, '');
    if (!digits) {
        registerForm.contactNumber = '+63';
        return;
    }

    if (digits.startsWith('63')) {
        registerForm.contactNumber = `+63${digits.slice(2, 12)}`;
        return;
    }

    if (digits.startsWith('09')) {
        registerForm.contactNumber = `+63${digits.slice(1, 11)}`;
        return;
    }

    if (digits.startsWith('9')) {
        registerForm.contactNumber = `+63${digits.slice(0, 10)}`;
        return;
    }

    registerForm.contactNumber = `+63${digits.slice(0, 10)}`;
};

const guestReportFormDefaults = {
    reportType: 'noise_complaint',
    description: '',
    locationText: '',
    locationLatitude: '',
    locationLongitude: '',
    locationAccuracy: '',
    incidentDate: '',
    priority: 'medium',
    firstName: '',
    middleName: '',
    lastName: '',
    suffix: '',
    contactNumber: '',
    email: '',
    address: '',
    agreePrivacy: false
};
const guestReportForm = reactive({ ...guestReportFormDefaults });
const guestReportProofFiles = ref([]);
const guestLocatingPosition = ref(false);
const guestHasCapturedCoordinates = computed(() => Boolean(guestReportForm.locationLatitude && guestReportForm.locationLongitude));
const guestReportMapEmbedUrl = computed(() => {
    if (!guestHasCapturedCoordinates.value) {
        return '';
    }

    return `https://maps.google.com/maps?q=${guestReportForm.locationLatitude},${guestReportForm.locationLongitude}&z=16&output=embed`;
});
const localizeReportTypeConfig = (type) => {
    const key = REPORT_TYPE_CONFIG[type] ? type : 'other';
    const config = REPORT_TYPE_CONFIG[key];
    return {
        ...config,
        label: t(`reportTypes.${key}.label`),
        descriptionPlaceholder: t(`reportTypes.${key}.descriptionPlaceholder`),
        locationHint: t(`reportTypes.${key}.locationHint`),
        proofLabel: t(`reportTypes.${key}.proofLabel`)
    };
};
const guestReportTypeConfig = computed(() => localizeReportTypeConfig(guestReportForm.reportType));
const createGuestAppointmentFormDefaults = () => ({
    category: '',
    officialId: '',
    appointmentDate: getMinimumAppointmentDate(),
    startTime: '',
    endTime: '',
    purpose: '',
    firstName: '',
    middleName: '',
    lastName: '',
    suffix: '',
    contactNumber: '',
    email: '',
    address: '',
    agreePrivacy: false
});
const guestAppointmentForm = reactive(createGuestAppointmentFormDefaults());
const guestAppointmentSlots = ref([]);
const guestAppointmentSelectedSlot = ref('');
const isGuestAppointmentSlotsLoading = ref(false);
const isGuestAppointmentLoading = ref(false);
const guestReservationFormDefaults = {
    facilityName: 'barangay_hall',
    reservationDate: '',
    startTime: '',
    endTime: '',
    quantity: 0,
    purpose: '',
    reservationDetails: '',
    firstName: '',
    middleName: '',
    lastName: '',
    suffix: '',
    contactNumber: '',
    email: '',
    address: '',
    agreePrivacy: false
};
const guestReservationForm = reactive({ ...guestReservationFormDefaults });
const guestFacilityAvailability = ref(null);
const isGuestFacilityAvailabilityLoading = ref(false);
const guestFacilityTimeOptions = computed(() => buildFacilityTimeOptions(guestFacilityAvailability.value, guestReservationForm.startTime));
const guestReservationInventoryPeakSummary = computed(() => buildFacilityInventoryPeakSummary(guestFacilityAvailability.value));
const selectedGuestReservationItem = computed(() => getFacilityItemOption(guestReservationForm.facilityName) || FACILITY_ITEM_OPTIONS[0]);
const guestReservationRequiresQuantity = computed(() => selectedGuestReservationItem.value?.isInventory === true);
const guestReservationHasSelectedTime = computed(() => Boolean(guestReservationForm.startTime && guestReservationForm.endTime));
const guestReservationAvailableQuantity = computed(() => {
    if (!guestReservationRequiresQuantity.value || !guestReservationHasSelectedTime.value) {
        return null;
    }

    const availableQuantity = Number(guestFacilityAvailability.value?.availableQuantity);
    return Number.isFinite(availableQuantity) ? availableQuantity : null;
});
const guestReservationQuantityMax = computed(() => {
    const availableQuantity = guestReservationAvailableQuantity.value;
    return availableQuantity === null ? selectedGuestReservationItem.value.max : Math.max(availableQuantity, 0);
});
const guestReservationInventoryUnavailable = computed(() => guestReservationRequiresQuantity.value && guestReservationAvailableQuantity.value !== null && guestReservationAvailableQuantity.value <= 0);
const guestReservationInventoryMessage = computed(() => {
    if (!guestReservationRequiresQuantity.value || !guestReservationHasSelectedTime.value) {
        return '';
    }

    const availableQuantity = guestReservationAvailableQuantity.value;
    const label = selectedGuestReservationItem.value?.availableLabel || 'items';

    if (availableQuantity !== null && availableQuantity <= 0) {
        return `No ${label} are available for the selected date and time. Please choose another time.`;
    }

    const requestedQuantity = Number(guestReservationForm.quantity || 0);
    if (availableQuantity !== null && requestedQuantity > availableQuantity) {
        return `Only ${availableQuantity} ${label} are available for the selected date and time.`;
    }

    return '';
});
const canSubmitGuestReservation = computed(() => {
    if (isGuestReservationLoading.value || !guestReservationForm.agreePrivacy || !guestReservationForm.startTime || !guestReservationForm.endTime) {
        return false;
    }

    if (!guestReservationRequiresQuantity.value) {
        return true;
    }

    const requestedQuantity = Number(guestReservationForm.quantity || 0);
    return requestedQuantity > 0 && !guestReservationInventoryUnavailable.value && requestedQuantity <= guestReservationQuantityMax.value;
});

const clampGuestReservationQuantityToAvailability = () => {
    if (!guestReservationRequiresQuantity.value) {
        guestReservationForm.quantity = 0;
        return;
    }

    const maxQuantity = Number(guestReservationQuantityMax.value);
    if (Number.isFinite(maxQuantity) && maxQuantity > 0) {
        guestReservationForm.quantity = Math.min(Math.max(Number(guestReservationForm.quantity) || 1, 1), maxQuantity);
    }
};

const loadGuestFacilityAvailability = async () => {
    guestReservationForm.startTime = '';
    guestReservationForm.endTime = '';
    guestReservationForm.quantity = guestReservationRequiresQuantity.value ? Math.max(Number(guestReservationForm.quantity) || 1, 1) : 0;

    if (!guestReservationForm.facilityName || !guestReservationForm.reservationDate) {
        guestFacilityAvailability.value = null;
        return;
    }

    isGuestFacilityAvailabilityLoading.value = true;
    try {
        const query = new URLSearchParams({
            facilityName: guestReservationForm.facilityName,
            date: guestReservationForm.reservationDate
        }).toString();
        guestFacilityAvailability.value = await apiFetch('/facility-reservations/availability/public?' + query);
        clampGuestReservationQuantityToAvailability();
    } catch (error) {
        guestFacilityAvailability.value = null;
        setStatus(error.message || 'Failed to load facility schedule.', true);
    } finally {
        isGuestFacilityAvailabilityLoading.value = false;
    }
};

const loadGuestFacilityAvailabilityForTime = async () => {
    if (!guestReservationForm.facilityName || !guestReservationForm.reservationDate) {
        return;
    }

    isGuestFacilityAvailabilityLoading.value = true;
    try {
        const query = new URLSearchParams({
            facilityName: guestReservationForm.facilityName,
            date: guestReservationForm.reservationDate,
            ...(guestReservationForm.startTime ? { startTime: guestReservationForm.startTime } : {}),
            ...(guestReservationForm.endTime ? { endTime: guestReservationForm.endTime } : {})
        }).toString();
        guestFacilityAvailability.value = await apiFetch('/facility-reservations/availability/public?' + query);
        clampGuestReservationQuantityToAvailability();
    } catch (error) {
        guestFacilityAvailability.value = null;
        setStatus(error.message || 'Failed to load facility schedule.', true);
    } finally {
        isGuestFacilityAvailabilityLoading.value = false;
    }
};

// Ensure privacy flag exists on register form (composable may not include it)
if (registerForm.agreePrivacy === undefined) {
    registerForm.agreePrivacy = false;
}
const registerHasSuffix = ref(Boolean(registerForm.suffix));
const registerFieldErrors = reactive({});
const registerErrorFieldOrder = [
    'firstName',
    'lastName',
    'sex',
    'birthDate',
    'contactNumber',
    'email',
    'purok',
    'zone',
    'username',
    'password',
    'confirmPassword',
    'proofOfResidency',
    'recaptcha'
];
const registerFieldElementIds = {
    firstName: 'reg-firstname',
    lastName: 'reg-lastname',
    sex: 'reg-sex',
    birthDate: 'reg-birthdate',
    contactNumber: 'reg-contact',
    email: 'reg-email',
    purok: 'reg-purok',
    zone: 'reg-zone',
    username: 'reg-username',
    password: 'reg-password',
    confirmPassword: 'reg-confirm',
    proofOfResidency: 'reg-proof',
    recaptcha: 'g-recaptcha'
};

const clearRegisterErrors = () => {
    Object.keys(registerFieldErrors).forEach((field) => {
        delete registerFieldErrors[field];
    });
};

const setRegisterErrors = (errors = {}) => {
    clearRegisterErrors();
    Object.entries(errors || {}).forEach(([field, message]) => {
        if (message) registerFieldErrors[field] = message;
    });
    if (Object.keys(registerFieldErrors).length) {
        focusFirstRegisterError();
    }
};

const hasRegisterError = (field) => Boolean(registerFieldErrors[field]);
const registerInputClass = (field) => ['input-group', { 'has-error': hasRegisterError(field) }];

const focusFirstRegisterError = async () => {
    await nextTick();

    const firstErrorField = registerErrorFieldOrder.find((field) => hasRegisterError(field))
        || Object.keys(registerFieldErrors)[0];

    if (!firstErrorField) return;

    const target = document.getElementById(registerFieldElementIds[firstErrorField] || '');
    if (!target) return;

    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });

    if (typeof target.focus === 'function') {
        target.focus({ preventScroll: true });
    }
};

watch(registerHasSuffix, (hasSuffix) => {
    if (!hasSuffix) {
        registerForm.suffix = '';
    }
});

watch(
    () => ({
        firstName: registerForm.firstName,
        lastName: registerForm.lastName,
        sex: registerForm.sex,
        birthDate: registerForm.birthDate,
        contactNumber: registerForm.contactNumber,
        email: registerForm.email,
        purok: registerForm.purok,
        zone: registerForm.zone,
        username: registerForm.username,
        password: registerForm.password,
        confirmPassword: registerForm.confirmPassword,
        agreePrivacy: registerForm.agreePrivacy,
        proofOfResidency: proofOfResidencyFile.value
    }),
    () => {
        clearRegisterErrors();
    },
    { deep: true }
);
const passwordVisibility = reactive({
    login: false,
    register: false,
    registerConfirm: false,
    reset: false,
    resetConfirm: false
});

const registerPasswordRules = computed(() => {
    return getPasswordRequirementRules(registerForm.password);
});

const registerPasswordStrong = computed(() => isStrongPassword(registerForm.password));

const resetPasswordRules = computed(() => {
    return getPasswordRequirementRules(resetPasswordForm.password, resetPasswordForm.confirmPassword);
});

const togglePasswordVisibility = (field) => {
    passwordVisibility[field] = !passwordVisibility[field];
};

const clearToast = () => {
    toastMessage.value = '';
    toastType.value = 'success';

    if (toastTimer) {
        clearTimeout(toastTimer);
        toastTimer = null;
    }
};

const setStatus = (message, isError = false) => {
    clearToast();

    if (!message) {
        return;
    }

    toastMessage.value = localizeFeedbackMessage({ message, isError, locale: locale.value, t });
    toastType.value = isError ? 'error' : 'success';
    toastTimer = setTimeout(() => {
        clearToast();
    }, 3500);
};

const resumeOtpVerification = () => {
    const email = pendingOtpEmail.value || getPendingOtpEmail();
    if (!email) {
        setStatus('Please register first to receive an OTP.', true);
        return;
    }

    pendingOtpEmail.value = email;
    otpForm.email = email;
    openModal('otp');
};

const officials = ref([]);
const officialsLoading = ref(false);
const mapLoaded = ref(false);
const locationBandRef = ref(null);
let locationMapObserver = null;
const positionOrder = {
    'Barangay Captain': 1,
    'Barangay Secretary': 2,
    'Barangay Treasurer': 3,
    'Barangay Kagawad': 4,
    'Other': 5
};

const sortedOfficials = computed(() => {
    return [...officials.value].sort((a, b) => {
        const orderA = positionOrder[a.position] || 99;
        const orderB = positionOrder[b.position] || 99;

        if (orderA !== orderB) {
            return orderA - orderB;
        }

        return String(a.name || '').localeCompare(String(b.name || ''));
    });
});
const selectedGuestAppointmentOfficial = computed(() => officials.value.find((official) => official._id === guestAppointmentForm.officialId) || null);
const guestAppointmentCategoryOfficials = computed(() => filterOfficialsByAppointmentCategory(sortedOfficials.value, guestAppointmentForm.category));
const selectedGuestAppointmentOfficialInactive = computed(() => Boolean(selectedGuestAppointmentOfficial.value && selectedGuestAppointmentOfficial.value.status !== 'active'));
const guestAppointmentInactiveMessage = computed(() => {
    if (!selectedGuestAppointmentOfficialInactive.value) {
        return '';
    }

    const reason = String(selectedGuestAppointmentOfficial.value?.notes || '').trim() || 'No reason provided';
    return `This official is currently inactive: ${reason}`;
});
const guestAppointmentSlotsAvailable = computed(() => guestAppointmentSlots.value.filter((slot) => slot.isAvailable));
const canSubmitGuestAppointment = computed(() => (
    !isGuestAppointmentLoading.value
    && guestAppointmentForm.agreePrivacy
    && guestAppointmentForm.category
    && guestAppointmentForm.officialId
    && guestAppointmentForm.appointmentDate
    && guestAppointmentForm.startTime
    && guestAppointmentForm.endTime
    && !selectedGuestAppointmentOfficialInactive.value
));

const getOfficialInitials = (official) => {
    const names = String(official.name || '').split(' ').filter(Boolean);
    if (!names.length) return 'BI';
    return names.slice(0, 2).map((part) => part[0].toUpperCase()).join('');
};

const getGuestAppointmentOfficialLabel = (official) => {
    const base = `${official.name} - ${official.position}`;
    if (official.status === 'active') {
        return base;
    }

    const reason = String(official.notes || '').trim() || 'No reason provided';
    return `${base} (Inactive: ${reason})`;
};

const loadOfficials = async () => {
    officialsLoading.value = true;
    try {
        const response = await apiFetch('/appointments/officials');
        officials.value = response.data || response;
    } catch (error) {
        console.error('Failed to load officials:', error);
    } finally {
        officialsLoading.value = false;
    }
};

const setupScrollAnimations = () => {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add('in-view');
            } else {
                entry.target.classList.remove('in-view');
            }
        });
    }, { threshold: 0.15 });

    document.querySelectorAll('.animate-section').forEach((section) => observer.observe(section));
};

const loadOfficialsAndAnimations = async () => {
    await loadOfficials();
    setupScrollAnimations();
};

const loadRecaptcha = () => {
    return ensureRecaptchaReady()
        .then(() => {
            renderRecaptchaCheckbox();
        })
        .catch((error) => {
            console.error('reCaptcha loading error:', error);
            setStatus('reCaptcha failed to load. Please refresh the page.', true);
        });
};

    const setupLocationMapLazyLoad = () => {
        if (mapLoaded.value) {
            return;
        }

        if (typeof IntersectionObserver === 'undefined' || !locationBandRef.value) {
            mapLoaded.value = true;
            return;
        }

        locationMapObserver = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                mapLoaded.value = true;
                if (locationMapObserver) {
                    locationMapObserver.disconnect();
                    locationMapObserver = null;
                }
            }
        }, { rootMargin: '200px 0px' });

        locationMapObserver.observe(locationBandRef.value);
    };

// UI helpers
const getModalTitle = (mode) => {
    const auth = texts.value.landing.auth;
    if (mode === 'login') return auth.login.title;
    if (mode === 'register') return auth.register.title;
    if (mode === 'otp') return auth.otp.title;
    if (mode === 'forgot-password') return auth.forgot.title;
    if (mode === 'reset-password') return auth.reset.title;
    if (mode === 'pending-approval') return auth.pending.title;
    if (mode === 'guest-report-request') return auth.guestReport.title;
    if (mode === 'guest-appointment-request') return auth.guestAppointment.title;
    if (mode === 'guest-facility-request') return auth.guestReservation.title;
    return 'Resident Portal';
};

const getVisualTitle = (mode) => {
    const auth = texts.value.landing.auth;
    if (mode === 'login') return auth.login.visualTitle;
    if (mode === 'register') return auth.register.visualTitle;
    if (mode === 'otp') return auth.otp.visualTitle;
    if (mode === 'forgot-password') return auth.forgot.visualTitle;
    if (mode === 'reset-password') return auth.reset.visualTitle;
    if (mode === 'pending-approval') return auth.pending.visualTitle;
    if (mode === 'guest-report-request') return auth.guestReport.visualTitle;
    if (mode === 'guest-appointment-request') return auth.guestAppointment.visualTitle;
    if (mode === 'guest-facility-request') return auth.guestReservation.visualTitle;
    return 'Resident Portal';
};

const getVisualCopy = (mode) => {
    const auth = texts.value.landing.auth;
    if (mode === 'login') return auth.login.visualCopy;
    if (mode === 'register') return auth.register.visualCopy;
    if (mode === 'otp') return auth.otp.visualCopy;
    if (mode === 'forgot-password') return auth.forgot.visualCopy;
    if (mode === 'reset-password') return auth.reset.visualCopy;
    if (mode === 'pending-approval') return auth.pending.visualCopy;
    if (mode === 'guest-report-request') return auth.guestReport.visualCopy;
    if (mode === 'guest-appointment-request') return auth.guestAppointment.visualCopy;
    if (mode === 'guest-facility-request') return auth.guestReservation.visualCopy;
    return 'Access barangay services securely from any device.';
};

const getToggleLabel = (mode) => {
    const auth = texts.value.landing.auth;
    if (mode === 'login') return auth.login.toggleLabel;
    if (mode === 'register') return auth.register.toggleLabel;
    if (mode === 'forgot-password' || mode === 'reset-password') return 'Back to Login';
    return auth.login.toggleLabel;
};

const getToggleText = (mode) => {
    const auth = texts.value.landing.auth;
    if (mode === 'login') return auth.login.toggleNoAccount;
    if (mode === 'register') return auth.register.toggleHaveAccount;
    if (mode === 'forgot-password' || mode === 'reset-password') return 'Need to go back?';
    return '';
};

const switchAuthMode = () => {
    if (activeModal.value === 'login') {
        activeModal.value = 'register';
        return;
    }

    if (activeModal.value === 'register') {
        activeModal.value = 'login';
        return;
    }

    activeModal.value = 'login';
};

const openModal = (mode) => {
    const prev = activeModal.value;
    // If we're leaving the register modal, clean up the recaptcha widget to avoid stale DOM/state
    if (prev === 'register' && mode !== 'register') {
        cleanupRecaptchaWidget();
    }

    activeModal.value = mode;
    setStatus('');
    if (mode === 'guest-report-request') {
        resetGuestReportForm();
    }
    if (mode === 'guest-appointment-request') {
        resetGuestAppointmentForm();
    }
    if (mode === 'guest-facility-request') {
        resetGuestReservationForm();
    }
    if (mode === 'otp' && !otpForm.email) {
        otpForm.email = getPendingOtpEmail();
    }
    if (mode !== 'reset-password') {
        resetPasswordForm.resetToken = '';
        resetPasswordForm.password = '';
        resetPasswordForm.confirmPassword = '';
    }
    // Pre-load reCaptcha script when registration modal opens
    if (mode === 'register') {
        // Use nextTick to ensure DOM is updated before loading recaptcha
        nextTick(() => {
            loadRecaptcha();
        });
    }
};

// Privacy overlay helpers: show policy as an overlay so underlying modal DOM (e.g. register) stays mounted
const privacyOverlay = ref(false);
const privacyPrevModal = ref('');

const showPrivacy = (prev = '') => {
    privacyPrevModal.value = prev || '';
    privacyOverlay.value = true;
};

const hidePrivacyOverlay = () => {
    privacyOverlay.value = false;
    // We intentionally do not change activeModal here; the underlying modal remains as it was
};

const closeModal = () => {
    // Clear recaptcha container when closing register modal to avoid stale state
    if (activeModal.value === 'register') {
        cleanupRecaptchaWidget();
    }
    clearToast();
    activeModal.value = '';
};

const clearAuthModalUrl = () => {
    if (!globalThis.history?.replaceState) return;
    const url = new URL(globalThis.location.href);
    url.searchParams.delete('auth');
    globalThis.history.replaceState({}, '', url.pathname + url.search);
};

const isLoginLoading = ref(false);

const handleLogin = async () => {
    if (isLoginLoading.value) return;
    isLoginLoading.value = true;
    try {
        const result = await loginResident(loginForm);
        if (!result.success) {
            setStatus(result.message, true);
            return;
        }
        setStatus('');
    } finally {
        isLoginLoading.value = false;
    }
};

const isRegisterLoading = ref(false);

const handleFileUpload = (event) => {
    const file = event.target?.files?.[0] || null;
    const error = getFileSizeError(file);

    if (error) {
        event.target.value = '';
        setProofOfResidencyFile({ target: { files: [] } });
        registerFieldErrors.proofOfResidency = error;
        setStatus(error, true);
        return;
    }

    delete registerFieldErrors.proofOfResidency;
    setProofOfResidencyFile(event);
};

const handleRegister = async () => {
    if (isRegisterLoading.value) return;
    clearRegisterErrors();
    if (!registerForm.agreePrivacy) {
        setStatus('Please accept the Privacy Policy before registering.', true);
        return;
    }
    if (!registerPasswordStrong.value) {
        setRegisterErrors({ password: 'Complete all password requirements before submitting.' });
        setStatus('Password does not meet all required security rules yet.', true);
        return;
    }

    isRegisterLoading.value = true;
    try {
        const recaptchaToken = getRecaptchaToken();
        const result = await registerResident(registerForm, proofOfResidencyFile.value, recaptchaToken);
        if (result.success) {
            otpForm.email = result.email;
            pendingOtpEmail.value = result.email;
            setPendingOtpEmail(result.email);
            openModal('otp');
            setStatus(result.message, false);
        } else {
            setRegisterErrors(result.fieldErrors);
            setStatus(result.message, true);
            resetRecaptcha();
        }
    } finally {
        isRegisterLoading.value = false;
    }
};

const isOtpLoading = ref(false);

const handleVerifyOtp = async () => {
    if (isOtpLoading.value) return;
    isOtpLoading.value = true;
    try {
        const result = await verifyOtp(otpForm);
        if (result.success) {
            openModal('pending-approval');
            otpForm.code = '';
            pendingOtpEmail.value = '';
            clearPendingOtpEmail();
        } else {
            setStatus(result.message, true);
        }
    } finally {
        isOtpLoading.value = false;
    }
};

const isResendOtpLoading = ref(false);

const handleResendOtp = async () => {
    if (isResendOtpLoading.value) return;
    isResendOtpLoading.value = true;
    try {
        const result = await resendOtp(otpForm);
        setStatus(result.message, !result.success);
    } finally {
        isResendOtpLoading.value = false;
    }
};

const handleForgotPassword = async () => {
    const result = await requestPasswordReset();
    if (result.success) {
        activeModal.value = 'login';
        setStatus(result.message, false);
    } else {
        setStatus(result.message, true);
    }
};

const handleResetPassword = async () => {
    if (resetPasswordRules.value.some((rule) => !rule.passed)) {
        setStatus('Please complete all password requirements.', true);
        return;
    }

    const result = await submitPasswordReset();
    if (result.success) {
        activeModal.value = 'login';
        setStatus(result.message, false);
    } else {
        setStatus(result.message, true);
    }
};

const resetGuestReportForm = () => {
    Object.assign(guestReportForm, guestReportFormDefaults);
    guestReportProofFiles.value = [];
};

const resetGuestAppointmentForm = () => {
    Object.assign(guestAppointmentForm, createGuestAppointmentFormDefaults());
    guestAppointmentSlots.value = [];
    guestAppointmentSelectedSlot.value = '';
};

const resetGuestReservationForm = () => {
    Object.assign(guestReservationForm, guestReservationFormDefaults);
    guestFacilityAvailability.value = null;
};

const isGuestReportLoading = ref(false);

const handleGuestReportProofFiles = (event) => {
    const incoming = Array.from(event.target.files || []);
    const error = getFilesSizeError(incoming);

    if (error) {
        event.target.value = '';
        guestReportProofFiles.value = [];
        setStatus(error, true);
        return;
    }

    guestReportProofFiles.value = incoming.slice(0, 5);
};

const clearGuestAppointmentSlotSelection = () => {
    guestAppointmentSelectedSlot.value = '';
    guestAppointmentForm.startTime = '';
    guestAppointmentForm.endTime = '';
};

const handleGuestAppointmentCategoryChange = () => {
    guestAppointmentForm.officialId = '';
    guestAppointmentForm.appointmentDate = getMinimumAppointmentDate();
    clearGuestAppointmentSlotSelection();
    guestAppointmentSlots.value = [];
};

const handleGuestAppointmentOfficialChange = () => {
    clearGuestAppointmentSlotSelection();
    guestAppointmentSlots.value = [];
    loadGuestAppointmentSlots();
};

const applyGuestAppointmentSlot = () => {
    const [startTime, endTime] = String(guestAppointmentSelectedSlot.value || '').split('|');
    guestAppointmentForm.startTime = startTime || '';
    guestAppointmentForm.endTime = endTime || '';
};

const loadGuestAppointmentSlots = async () => {
    clearGuestAppointmentSlotSelection();
    guestAppointmentSlots.value = [];

    if (guestAppointmentForm.appointmentDate < getMinimumAppointmentDate()) {
        guestAppointmentForm.appointmentDate = getMinimumAppointmentDate();
    }

    if (!guestAppointmentForm.officialId || !guestAppointmentForm.appointmentDate || selectedGuestAppointmentOfficialInactive.value) {
        return;
    }

    isGuestAppointmentSlotsLoading.value = true;
    try {
        const query = new URLSearchParams({
            officialId: guestAppointmentForm.officialId,
            appointmentDate: guestAppointmentForm.appointmentDate
        }).toString();
        const response = await apiFetch('/appointments/available-slots/public?' + query);
        guestAppointmentSlots.value = response.data || response || [];
    } catch (error) {
        guestAppointmentSlots.value = [];
        setStatus(error.message || 'Failed to load appointment slots.', true);
    } finally {
        isGuestAppointmentSlotsLoading.value = false;
    }
};

const isGuestSafariBrowser = () => {
    const userAgent = navigator.userAgent || '';
    return /Safari/i.test(userAgent) && !/Chrome|CriOS|Edg|OPR|FxiOS|Android/i.test(userAgent);
};

const requestGuestGeolocation = (options) => new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
});

const readGuestGeolocationPermissionState = async () => {
    try {
        if (!navigator.permissions?.query) {
            return 'unknown';
        }

        const permission = await navigator.permissions.query({ name: 'geolocation' });
        return permission.state;
    } catch {
        return 'unknown';
    }
};

const isGuestSecureGeolocationContext = () => globalThis.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';

const getGuestGeolocationErrorMessage = (error, safari) => {
    if (error?.code === 1) {
        return safari
            ? '🔒 Safari location access is blocked for this site. On iPhone: Settings → Privacy & Security → Location Services → Safari Websites → While Using the App. Then open this site in Safari again and tap "Use My Current Location".'
            : '🔒 Location access is blocked in this browser. Go to your browser settings → Permissions → Location, and allow access for this site. Then come back and try again.';
    }

    if (error?.code === 2) {
        return safari
            ? '⚠️ Safari could not get your location. Make sure iPhone Location Services is ON and Safari Websites is set to "While Using the App", then try again.'
            : '⚠️ Location Not Available: Make sure Location Services/GPS is ON in your phone settings, and you have a good network signal. Then try again.';
    }

    if (error?.code === 3) {
        return '⏱️ Timeout: Getting your location is taking too long. Check that Location Services is ON and your network is working, then try again.';
    }

    return error?.message || 'Unable to capture your location.';
};

const captureGuestCurrentLocation = async () => {
    if (!navigator.geolocation) {
        setStatus('Geolocation is not supported on this device/browser.', true);
        return;
    }

    const safari = isGuestSafariBrowser();
    if (!isGuestSecureGeolocationContext()) {
        setStatus('Geolocation requires a secure connection (HTTPS). Please ensure you\'re using HTTPS on this site.', true);
        return;
    }

    guestLocatingPosition.value = true;

    try {
        const permissionState = await readGuestGeolocationPermissionState();

        if (permissionState === 'denied') {
            setStatus(
                safari
                    ? '🔒 Safari location access is blocked for this site. On iPhone: Settings → Privacy & Security → Location Services → Safari Websites → While Using the App. Then open this site in Safari again and tap "Use My Current Location".'
                    : '🔒 Location access is blocked in this browser. Go to your browser settings → Permissions → Location, and allow access for this site. Then come back and try again.',
                true
            );
            return;
        }

        const position = await requestGuestGeolocation({
            enableHighAccuracy: true,
            timeout: 30000,
            maximumAge: 5000
        });

        guestReportForm.locationLatitude = String(position.coords.latitude.toFixed(6));
        guestReportForm.locationLongitude = String(position.coords.longitude.toFixed(6));
        guestReportForm.locationAccuracy = String(Math.round(position.coords.accuracy || 0));
        setStatus('Current location captured.');
    } catch (error) {
        if (error?.code !== 1) {
            try {
                const fallbackPosition = await requestGuestGeolocation({
                    enableHighAccuracy: false,
                    timeout: 10000,
                    maximumAge: 0
                });

                guestReportForm.locationLatitude = String(fallbackPosition.coords.latitude.toFixed(6));
                guestReportForm.locationLongitude = String(fallbackPosition.coords.longitude.toFixed(6));
                guestReportForm.locationAccuracy = String(Math.round(fallbackPosition.coords.accuracy || 0));
                setStatus('Location captured (lower accuracy mode).');
                return;
            } catch (fallbackError) {
                error = fallbackError;
            }
        }

        setStatus(getGuestGeolocationErrorMessage(error, safari), true);
    } finally {
        guestLocatingPosition.value = false;
    }
};

const handleGuestReportRequest = async () => {
    if (isGuestReportLoading.value) return;
    if (!guestReportForm.agreePrivacy) {
        setStatus('Please accept the Privacy Policy before submitting your report.', true);
        return;
    }

    if (guestReportTypeConfig.value.requireProof && guestReportProofFiles.value.length === 0) {
        setStatus('Please upload at least one proof image for this report type.', true);
        return;
    }

    if (guestReportForm.incidentDate && guestReportForm.incidentDate > todayDate) {
        setStatus('Date cannot be in the future.', true);
        return;
    }

    isGuestReportLoading.value = true;
    try {
        const submittedEmail = String(guestReportForm.email || '').trim().toLowerCase();
        const payload = new FormData();

        payload.append('reportType', String(guestReportForm.reportType || '').trim());
        payload.append('description', String(guestReportForm.description || '').trim());
        payload.append('locationText', String(guestReportForm.locationText || '').trim());
        payload.append('incidentDate', guestReportForm.incidentDate || '');
        payload.append('priority', guestReportForm.priority);
        payload.append('firstName', String(guestReportForm.firstName || '').trim());
        payload.append('middleName', String(guestReportForm.middleName || '').trim());
        payload.append('lastName', String(guestReportForm.lastName || '').trim());
        payload.append('suffix', String(guestReportForm.suffix || '').trim());
        payload.append('contactNumber', String(guestReportForm.contactNumber || '').trim());
        payload.append('email', submittedEmail);
        payload.append('address', String(guestReportForm.address || '').trim());
        payload.append('locationLatitude', String(guestReportForm.locationLatitude || ''));
        payload.append('locationLongitude', String(guestReportForm.locationLongitude || ''));
        payload.append('locationAccuracy', String(guestReportForm.locationAccuracy || ''));

        guestReportProofFiles.value.forEach((file) => {
            payload.append('proofFiles', file);
        });

        const result = await apiFetch('/reports/public', {
            method: 'POST',
            body: payload
        });

        resetGuestReportForm();
        closeModal();
        setStatus(`Report submitted. We will send the update to ${result.email || submittedEmail}.`, false);
    } catch (error) {
        setStatus(error.message, true);
    } finally {
        isGuestReportLoading.value = false;
    }
};

const handleGuestAppointmentRequest = async () => {
    if (isGuestAppointmentLoading.value) return;

    if (!guestAppointmentForm.agreePrivacy) {
        setStatus('Please accept the Privacy Policy before submitting your appointment request.', true);
        return;
    }

    if (selectedGuestAppointmentOfficialInactive.value) {
        setStatus(guestAppointmentInactiveMessage.value, true);
        return;
    }

    if (!guestAppointmentForm.startTime || !guestAppointmentForm.endTime) {
        setStatus('Please choose an available appointment time slot.', true);
        return;
    }

    isGuestAppointmentLoading.value = true;
    try {
        const payload = {
            category: guestAppointmentForm.category,
            officialId: String(guestAppointmentForm.officialId || '').trim(),
            appointmentDate: guestAppointmentForm.appointmentDate,
            startTime: String(guestAppointmentForm.startTime || '').trim(),
            endTime: String(guestAppointmentForm.endTime || '').trim(),
            purpose: String(guestAppointmentForm.purpose || '').trim(),
            firstName: String(guestAppointmentForm.firstName || '').trim(),
            middleName: String(guestAppointmentForm.middleName || '').trim(),
            lastName: String(guestAppointmentForm.lastName || '').trim(),
            suffix: String(guestAppointmentForm.suffix || '').trim(),
            contactNumber: String(guestAppointmentForm.contactNumber || '').trim(),
            email: String(guestAppointmentForm.email || '').trim().toLowerCase(),
            address: String(guestAppointmentForm.address || '').trim()
        };

        const result = await apiFetch('/appointments/request/public', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        resetGuestAppointmentForm();
        closeModal();
        setStatus(`Appointment request submitted. We will send the update to ${result.data?.email || payload.email}.`, false);
    } catch (error) {
        setStatus(error.message, true);
    } finally {
        isGuestAppointmentLoading.value = false;
    }
};

const isGuestReservationLoading = ref(false);

const handleGuestReservationRequest = async () => {
    if (isGuestReservationLoading.value) return;
    if (!guestReservationForm.agreePrivacy) {
        setStatus('Please accept the Privacy Policy before submitting your reservation request.', true);
        return;
    }

    if (guestReservationRequiresQuantity.value) {
        const availableQuantity = Number(guestFacilityAvailability.value?.availableQuantity);

        if (Number.isFinite(availableQuantity)) {
            const requestedQuantity = Number(guestReservationForm.quantity || 0);

            if (availableQuantity <= 0) {
                setStatus(`No ${selectedGuestReservationItem.value?.availableLabel || 'items'} are available for the selected time.`, true);
                return;
            }

            if (requestedQuantity > availableQuantity) {
                setStatus(`Only ${availableQuantity} ${selectedGuestReservationItem.value?.availableLabel || 'items'} are available for the selected time.`, true);
                return;
            }
        }
    }

    isGuestReservationLoading.value = true;
    try {
        const payload = {
            ...guestReservationForm,
            facilityName: String(guestReservationForm.facilityName || '').trim(),
            reservationDate: guestReservationForm.reservationDate,
            startTime: String(guestReservationForm.startTime || '').trim(),
            endTime: String(guestReservationForm.endTime || '').trim(),
            purpose: String(guestReservationForm.purpose || '').trim(),
            reservationDetails: String(guestReservationForm.reservationDetails || '').trim(),
            firstName: String(guestReservationForm.firstName || '').trim(),
            middleName: String(guestReservationForm.middleName || '').trim(),
            lastName: String(guestReservationForm.lastName || '').trim(),
            suffix: String(guestReservationForm.suffix || '').trim(),
            contactNumber: String(guestReservationForm.contactNumber || '').trim(),
            email: String(guestReservationForm.email || '').trim().toLowerCase(),
            address: String(guestReservationForm.address || '').trim()
        };

        const quantity = Number(guestReservationForm.quantity || 0);
        if (payload.facilityName === 'chair') {
            payload.chairQuantity = quantity;
        } else if (payload.facilityName === 'tent') {
            payload.tentQuantity = quantity;
        } else if (payload.facilityName === 'table') {
            payload.tableQuantity = quantity;
        } else {
            payload.quantity = 0;
        }

        const result = await apiFetch('/facility-reservations/public', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        resetGuestReservationForm();
        closeModal();
        setStatus(`Facility request submitted. We will send the update to ${result.email || payload.email}.`, false);
    } catch (error) {
        setStatus(error.message, true);
    } finally {
        isGuestReservationLoading.value = false;
    }
};

const services = computed(() => [
    { icon: '📄', title: t('landing.services.documents.title'), copy: t('landing.services.documents.copy') },
    { icon: '🏛', title: t('landing.services.facilities.title'), copy: t('landing.services.facilities.copy'), action: 'guest-facility-request' },
    { icon: '🚩', title: t('landing.services.reports.title'), copy: t('landing.services.reports.copy'), action: 'guest-report-request' },
    { icon: '🔔', title: t('landing.services.announcements.title'), copy: t('landing.services.announcements.copy') },
    { icon: '🛡', title: t('landing.services.officials.title'), copy: t('landing.services.officials.copy'), action: 'guest-appointment-request' },
    { icon: '📍', title: t('landing.services.location.title'), copy: t('landing.services.location.copy') },
    { icon: '🏢', title: t('landing.services.community.title'), copy: t('landing.services.community.copy') }
]);

const handleServiceClick = (service) => {
    if (service.action) {
        openModal(service.action);
    }
};

const announcements = computed(() => [
    { title: 'Community Cleanup Drive', copy: texts.value.landing.sections.servicesCopy },
    { title: 'Document Request Window', copy: texts.value.landing.sections.announcementsCopy },
    { title: 'Facility Booking Reminder', copy: texts.value.landing.sections.officialsCopy }
]);

onMounted(() => {
    const pendingEmail = getPendingOtpEmail();
    if (pendingEmail) {
        pendingOtpEmail.value = pendingEmail;
        otpForm.email = pendingEmail;
    }

    const hasReset = hydrateResetPasswordFromUrl();
    if (hasReset) {
        activeModal.value = 'reset-password';
        setStatus('Create a new password to finish resetting your account.', false);
    } else {
        const params = new URLSearchParams(globalThis.location.search);
        if (params.get('auth') === 'login') {
            activeModal.value = 'login';
            clearAuthModalUrl();
        }
    }

    setupLocationMapLazyLoad();
    Promise.resolve().then(loadOfficialsAndAnimations);
});

onBeforeUnmount(() => {
    if (locationMapObserver) {
        locationMapObserver.disconnect();
        locationMapObserver = null;
    }
});

</script>

<style>
/* Google injects the image challenge iframe at document.body level, outside Vue's scoped styles. */
iframe[src*="recaptcha/api2/bframe"] {
    position: fixed !important;
    top: 50% !important;
    left: 50% !important;
    transform: translate(-50%, -50%) !important;
    width: min(400px, calc(100vw - 32px)) !important;
    max-width: calc(100vw - 32px) !important;
    height: min(580px, calc(100vh - 32px)) !important;
    max-height: calc(100vh - 32px) !important;
    z-index: 2147483647 !important;
}
</style>

<style scoped>
/* Highly Attractive Modern Split Auth Modal Styles */

.auth-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: rgba(16, 12, 10, 0.4);
    backdrop-filter: blur(12px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    overflow-y: auto;
    animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

.auth-modal-container {
    display: flex;
    background: #ffffff;
    border-radius: 28px;
    border: 1px solid rgba(22, 36, 26, 0.08);
    box-shadow: 0 40px 100px -20px rgba(0, 0, 0, 0.35);
    width: 100%;
    max-width: 900px;
    min-height: 550px;
    max-height: calc(100vh - 40px);
    position: relative;
    overflow: hidden;
    transition: max-width 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.auth-modal-container.is-register {
    max-width: 1100px;
}

.auth-modal-container.is-request {
    max-width: 1120px;
}

.auth-modal-close {
    position: absolute;
    top: 20px;
    right: 20px;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: #f5f5f5;
    color: #1a1a1a;
    font-size: 1.2rem;
    border: none;
    cursor: pointer;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.3s ease;
}

.auth-modal-close:hover {
    background: #1a1a1a;
    color: white;
    transform: rotate(90deg) scale(1.1);
}

/* Left Visual Side (Image/Branding) */
.auth-modal-visual {
    flex: 0 0 400px;
    background: url('/images/hero-bg-1280.jpg') center/cover no-repeat;
    position: relative;
    display: flex;
    padding: 40px;
    flex-direction: column;
    justify-content: flex-end;
}

.visual-overlay {
    position: absolute;
    inset: 0;
    background:
        linear-gradient(90deg, rgba(82, 12, 12, 0.8), rgba(16, 82, 36, 0.95)),
        linear-gradient(180deg, rgba(190, 0, 5, 0.3) 0%, rgba(16, 82, 36, 0.95) 100%);
    backdrop-filter: blur(2px);
    z-index: 1;
}

.visual-content {
    position: relative;
    z-index: 2;
    color: white;
}

.visual-text {
    margin-top: auto;
    padding-top: 40px;
}

.visual-text h3 {
    font-family: "Fraunces", serif;
    font-size: 2.2rem;
    line-height: 1.1;
    margin-bottom: 15px;
    color: #ffffff;
}

.visual-text p {
    font-size: 1.05rem;
    line-height: 1.6;
    color: rgba(255, 255, 255, 0.85);
}

/* Right Form Side */
.auth-modal-form-area {
    flex: 1;
    padding: 50px 60px;
    background: #ffffff;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    position: relative;
    height: 100%;
    min-height: 0;
    max-height: 90vh;
    overflow-y: auto;
}

.form-transition-wrapper {
    width: 100%;
}

.form-header {
    margin-bottom: 36px;
}

.modal-helper-copy {
    margin-top: 12px;
    font-size: 0.95rem;
    line-height: 1.55;
    color: #4f5f56;
}

.form-header h2 {
    font-family: inherit;
    font-size: 2rem;
    color: #1a1a1a;
    margin-bottom: 8px;
    letter-spacing: -0.5px;
}

.auth-toggle {
    font-size: 0.95rem;
    color: #5e6f66;
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
    margin-top: 12px;
}

.toggle-text {
    display: inline;
}

.toggle-link {
    background: none;
    border: none;
    padding: 0;
    font-weight: 600;
    color: #16241a;
    cursor: pointer;
    font-size: inherit;
    text-decoration: underline;
    text-decoration-color: rgba(22, 36, 26, 0.3);
    text-underline-offset: 4px;
    transition: all 0.2s;
    display: inline;
    white-space: nowrap;
}

.toggle-link:hover {
    color: #a41c1c;
    text-decoration-color: #a41c1c;
}

.modern-form {
    display: grid;
    gap: 22px;
}

.guest-request-banner {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: 44px 1fr;
    gap: 14px;
    align-items: start;
    padding: 18px 18px 16px;
    border-radius: 18px;
    background: linear-gradient(135deg, rgba(213, 42, 42, 0.08), rgba(35, 91, 130, 0.08));
    border: 1px solid rgba(22, 36, 26, 0.08);
}

.guest-request-banner i {
    width: 44px;
    height: 44px;
    border-radius: 14px;
    display: grid;
    place-items: center;
    background: #ffffff;
    color: #b50009;
    box-shadow: 0 10px 18px rgba(34, 40, 52, 0.08);
}

.guest-request-banner strong {
    display: block;
    font-size: 1rem;
    margin-bottom: 4px;
}

.guest-request-banner p {
    margin: 0;
    color: #4f5f56;
    line-height: 1.5;
}

.two-col-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
}

.input-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.input-group label {
    font-size: 0.9rem;
    font-weight: 600;
    color: #1a1a1a;
}

.input-group > label:not(.checkbox-label) {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    flex-wrap: nowrap;
    width: fit-content;
}

.input-wrapper {
    position: relative;
    display: flex;
    align-items: center;
}

.input-wrapper > i {
    position: absolute;
    left: 16px;
    color: #8b9d93;
    font-size: 1.1rem;
    pointer-events: none;
}

.input-wrapper input {
    padding-left: 44px !important;
}

.phone-input-wrapper {
    position: relative;
    display: flex;
    align-items: center;
}

.phone-country-badge {
    position: absolute;
    left: 12px;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    padding: 0 10px;
    border-right: 1px solid #d8e0dc;
    color: #20352c;
    font-size: 0.86rem;
    font-weight: 800;
    pointer-events: none;
}

.phone-country-flag {
    font-size: 1.1rem;
    line-height: 1;
}

.phone-input-wrapper input {
    padding-left: 94px !important;
}

/* Hide native browser password reveal/clear icons to avoid duplicate controls */
input[type="password"]::-ms-reveal,
input[type="password"]::-ms-clear {
    display: none;
}

/* Additional vendor selectors for Chrome/Edge (Blink) to hide password reveal/clear */
input[type="password"]::-webkit-clear-button,
input[type="password"]::-webkit-password-toggle-button,
input[type="password"]::-webkit-credentials-auto-fill-button {
    display: none !important;
    visibility: hidden !important;
    width: 0 !important;
    height: 0 !important;
}

.input-wrapper.has-toggle input {
    padding-right: 48px !important;
    min-height: 54px;
}

.password-toggle-btn {
    position: absolute;
    right: 12px;
    width: 32px;
    height: 32px;
    border-radius: 10px;
    border: none;
    background: transparent;
    color: #5e6f66;
    display: grid;
    place-items: center;
    transition: all 0.2s ease;
}

.password-toggle-btn i {
    position: static;
    color: #415349 !important;
    font-size: 1rem;
    pointer-events: none;
}

.password-toggle-btn:hover {
    background: #e8eeea;
    color: #16241a;
}

.password-rules {
    grid-column: 1 / -1;
    border-radius: 14px;
    border: 1px solid #e2e8e5;
    background: #f8faf9;
    padding: 12px 14px;
}

.password-rules-title {
    margin: 0 0 8px;
    font-size: 0.86rem;
    color: #4f5f56;
    font-weight: 600;
}

.password-rules-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
}

.password-rule-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.86rem;
}

.password-rule-item.is-fail {
    color: #c53a3a;
}

.password-rule-item.is-pass {
    color: #2c8a4e;
}

.input-group input,
.input-group select,
.input-group textarea {
    width: 100%;
    border-radius: 14px;
    border: 2px solid #e2e8e5;
    background: #f8faf9;
    padding: 15px 18px;
    font-size: 1rem;
    color: #1a1a1a;
    transition: all 0.3s ease;
    font-family: inherit;
}

.input-group input:hover,
.input-group select:hover,
.input-group textarea:hover {
    background: #f0f4f2;
}

.input-group input:focus,
.input-group select:focus,
.input-group textarea:focus {
    background: #ffffff;
    border-color: #1a1a1a;
    outline: none;
    box-shadow: 0 0 0 4px rgba(22, 36, 26, 0.08);
}

.required-mark {
    display: inline;
    flex-shrink: 0;
    color: #c53a3a;
    font-weight: 800;
}

.input-group.has-error input,
.input-group.has-error select,
.input-group.has-error textarea,
.input-group.has-error .file-upload-wrapper,
.recaptcha-shell.has-error .recaptcha-container {
    border-color: #c53a3a;
    background: #fff7f7;
    box-shadow: 0 0 0 4px rgba(197, 58, 58, 0.08);
}

.field-error {
    margin: 6px 0 0;
    color: #b42318;
    font-size: 0.84rem;
    font-weight: 700;
    line-height: 1.35;
}

.input-group textarea {
    min-height: 120px;
    resize: vertical;
}

.custom-select {
    position: relative;
}

.custom-select i {
    position: absolute;
    right: 18px;
    top: 50%;
    transform: translateY(-50%);
    color: #8b9d93;
    pointer-events: none;
}

.custom-select select {
    appearance: none;
    -webkit-appearance: none;
}

/* File Upload Beauty */
.file-upload-group {
    grid-column: 1 / -1;
}
.file-upload-wrapper {
    position: relative;
    border: 2px dashed #cbd5d0;
    padding: 20px;
    border-radius: 14px;
    background: #f8faf9;
    display: flex;
    align-items: center;
    gap: 16px;
    cursor: pointer;
    transition: all 0.3s;
}
.file-upload-wrapper:hover {
    border-color: #1a1a1a;
    background: #f0f4f2;
}
.file-input {
    position: absolute;
    inset: 0;
    opacity: 0;
    width: 100%;
    height: 100%;
    cursor: pointer;
}
.upload-btn {
    background: #1a1a1a;
    color: white;
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 0.9rem;
    font-weight: 500;
    pointer-events: none;
}
.file-name {
    color: #5e6f66;
    font-size: 0.95rem;
    font-family: monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 180px;
}

.recaptcha-container {
    display: flex;
    justify-content: center;
    align-items: center;
    margin: 10px 0;
    grid-column: 1 / -1;
    width: 100%;
    min-height: 78px;
    overflow: hidden;
}

.recaptcha-shell {
    display: grid;
    gap: 8px;
    grid-column: 1 / -1;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
}

@media (max-width: 480px) {
    .recaptcha-container {
        transform: scale(0.9);
        transform-origin: center;
        margin: 0;
        min-height: 90px;
    }
    
    .recaptcha-shell {
        padding: 0 5px;
    }
}

.recaptcha-loading {
    margin: 0;
    text-align: center;
    font-size: 0.9rem;
    color: #5e6f66;
}

.legal-text {
    text-align: center;
    font-size: 0.8rem;
    color: #8b9d93;
    grid-column: 1 / -1;
    margin-bottom: 6px;
}

.legal-text a {
    color: #5e6f66;
    font-weight: 600;
}

/* Checkbox Label Alignment */
.checkbox-label {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 0.95rem;
    color: #1a1a1a;
    cursor: pointer;
    font-weight: 400;
    line-height: 1.5;
    grid-column: 1 / -1;
}

.compact-checkbox {
    min-height: 52px;
    margin-bottom: 6px;
}

.privacy-consent-label {
    align-items: center;
    gap: 8px;
}

.privacy-consent-label span {
    display: inline;
    line-height: 1.45;
}

.checkbox-label input[type="checkbox"] {
    width: 20px;
    height: 20px;
    min-width: 20px;
    min-height: 20px;
    cursor: pointer;
    accent-color: #16241a;
    border-radius: 4px;
    border: 2px solid #e2e8e5;
    background: #ffffff;
    transition: all 0.2s ease;
}

.checkbox-label input[type="checkbox"]:hover {
    border-color: #16241a;
    box-shadow: 0 0 0 3px rgba(22, 36, 26, 0.08);
}

.checkbox-label input[type="checkbox"]:checked {
    background: #16241a;
    border-color: #16241a;
}

.checkbox-label a {
    color: #16241a;
    font-weight: 600;
    text-decoration: underline;
    text-decoration-thickness: 2px;
    text-underline-offset: 3px;
    transition: all 0.2s ease;
}

.checkbox-label a:hover {
    color: #2a4531;
}

/* Primary Form Submit Button */
.auth-submit-btn {
    background: linear-gradient(135deg, #16241a, #2a4531);
    color: white;
    border: none;
    padding: 18px 24px;
    border-radius: 14px;
    font-size: 1.1rem;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    transition: all 0.3s ease;
    grid-column: 1 / -1;
    box-shadow: 0 8px 20px rgba(22, 36, 26, 0.2);
}

.auth-submit-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 12px 28px rgba(22, 36, 26, 0.3);
    background: linear-gradient(135deg, #101c13, #1e3323);
}

.auth-submit-btn i {
    font-size: 1.1rem;
    transition: transform 0.3s;
}

.auth-submit-btn:hover i {
    transform: translateX(4px);
}

.auth-secondary-btn {
    background: transparent;
    color: #5e6f66;
    border: 2px solid #e2e8e5;
    padding: 16px 24px;
    border-radius: 14px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    grid-column: 1 / -1;
}

.auth-secondary-btn:hover {
    background: #f0f4f2;
    border-color: #cbd5d0;
    color: #1a1a1a;
}

/* OTP Specific */
.otp-instruction {
    text-align: center;
    color: #5e6f66;
    line-height: 1.6;
    margin-bottom: 10px;
}
.otp-input {
    text-align: center;
    font-size: 2rem !important;
    letter-spacing: 12px;
    padding: 20px !important;
    font-family: monospace;
    font-weight: bold;
}

/* Pending Approval View */
.pending-status-icon {
    display: flex;
    justify-content: center;
    font-size: 4rem;
    color: #4a90e2;
    margin-bottom: 20px;
    animation: pulse-ring 2s infinite ease-in-out;
}

@keyframes pulse-ring {
    0% { transform: scale(0.95); opacity: 0.8; }
    50% { transform: scale(1.05); opacity: 1; }
    100% { transform: scale(0.95); opacity: 0.8; }
}

.pending-info-card {
    background: #f8fafc;
    border-radius: 12px;
    padding: 20px;
    margin: 24px 0;
    border: 1px solid #e2e8f0;
}

.pending-info-card p {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 12px;
    font-size: 0.95rem;
    color: #475569;
    line-height: 1.5;
}

.pending-info-card p:last-child {
    margin-bottom: 0;
}

.pending-info-card i {
    margin-top: 3px;
    color: #4a90e2;
}

/* Privacy Policy Modal */
.privacy-policy-view {
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 0 !important;
    height: 100%;
}

.privacy-header {
    flex: 0 0 auto;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 30px 40px;
    border-bottom: 1px solid #e2e8e5;
    background: #ffffff;
    z-index: 10;
}

.privacy-header h2 {
    font-size: 1.8rem;
    font-weight: 600;
    color: #1a1a1a;
    margin: 0;
}

.privacy-close-btn {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: none;
    background: #f5f5f5;
    color: #1a1a1a;
    font-size: 1.1rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    flex-shrink: 0;
}

.privacy-close-btn:hover {
    background: #e0e0e0;
    transform: rotate(90deg);
}

.privacy-content {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 0 40px;
}

.privacy-section {
    margin-bottom: 28px;
    line-height: 1.7;
    padding-top: 24px;
}

.privacy-section:first-child {
    padding-top: 0;
}

.privacy-section h3 {
    font-size: 1.1rem;
    font-weight: 600;
    color: #1a1a1a;
    margin-bottom: 12px;
}

.privacy-section p {
    color: #4f5f56;
    font-size: 0.95rem;
    margin: 0 0 12px 0;
}

.privacy-section ul {
    margin: 12px 0;
    padding-left: 24px;
    color: #4f5f56;
    font-size: 0.95rem;
}

.privacy-section li {
    margin-bottom: 8px;
    line-height: 1.6;
}

.privacy-last {
    border-top: 1px solid #e2e8e5;
    padding-top: 20px;
    margin-top: 28px;
}

.privacy-updated {
    font-size: 0.85rem;
    color: #8b9d93;
    font-style: italic;
    margin: 0 0 24px;
}

.privacy-footer {
    flex: 0 0 auto;
    padding: 24px 40px;
    border-top: 1px solid #e2e8e5;
    background: #f8faf9;
    display: flex;
    gap: 12px;
}

.privacy-footer .auth-submit-btn {
    flex: 1;
}

.privacy-overlay {
    position: fixed;
    inset: 50% auto auto 50%;
    transform: translate(-50%, -50%);
    width: min(720px, calc(100vw - 32px));
    height: auto;
    max-height: min(82vh, 760px);
    z-index: 260;
    background: #ffffff;
    border-radius: 20px;
    border: 1px solid rgba(22, 36, 26, 0.12);
    box-shadow: 0 36px 90px rgba(0, 0, 0, 0.34);
    overflow: hidden;
}

.privacy-overlay .privacy-content {
    max-height: calc(min(82vh, 760px) - 154px);
}

/* Slide Transition Between Forms */
.fade-slide-enter-active,
.fade-slide-leave-active {
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.fade-slide-enter-from {
    opacity: 0;
    transform: translateY(15px);
}
.fade-slide-leave-to {
    opacity: 0;
    transform: translateY(-15px);
}

/* Responsive */
@media (max-width: 900px) {
    .auth-modal-backdrop {
        align-items: flex-start;
    }

    .auth-modal-container {
        flex-direction: column;
        max-width: 540px !important;
        max-height: calc(100vh - 40px);
        margin: auto;
    }

    .auth-modal-visual {
        display: flex;
        flex: 0 0 auto;
        min-height: 180px;
        padding: 22px 22px 18px;
        justify-content: flex-end;
    }

    .visual-content {
        width: 100%;
    }

    .visual-text {
        padding-top: 16px;
    }

    .visual-text h3 {
        font-size: 1.55rem;
        margin-bottom: 10px;
    }

    .visual-text p {
        font-size: 0.95rem;
    }

    .auth-modal-form-area {
        padding: 34px 24px 30px;
        max-height: none;
    }

    .two-col-grid {
        grid-template-columns: 1fr;
        gap: 22px;
    }
}
@media (max-width: 480px) {
    .auth-modal-container {
        max-height: calc(100vh - 20px);
        border-radius: 22px;
    }

    .modern-form {
        gap: 18px;
    }

    .input-group {
        min-width: 0;
        overflow: hidden;
    }

    .input-group input,
    .input-group select {
        font-size: 16px;
        padding: 12px 14px;
    }

    .input-wrapper input {
        padding-left: 40px !important;
    }

    .auth-modal-visual {
        min-height: 150px;
        padding: 18px;
    }

    .visual-text h3 {
        font-size: 1.35rem;
    }

    .visual-text p {
        font-size: 0.9rem;
        line-height: 1.5;
    }

    .auth-modal-form-area {
        padding: 26px 18px 24px;
    }
    .form-header h2 {
        font-size: 1.8rem;
    }
    .auth-modal-backdrop {
        padding: 10px;
    }
}

.animate-section {
    opacity: 0;
    transform: translateY(24px);
    transition: opacity 1.2s ease, transform 1.2s ease;
}
.animate-section.in-view {
    opacity: 1;
    transform: translateY(0);
}
.animate-section.slide-left {
    transform: translateX(-24px);
}
.animate-section.slide-right {
    transform: translateX(24px);
}
.animate-section.slide-up {
    transform: translateY(24px);
}
.animate-section.in-view.slide-left,
.animate-section.in-view.slide-right,
.animate-section.in-view.slide-up {
    transform: translateX(0) translateY(0);
}

    .landing-officials-section {
    padding: 60px 0;
    width: 100%;
    max-width: 100%;
    overflow-x: auto;
}

.officials-sections {
    display: flex;
    flex-direction: column;
    gap: 48px;
    margin-top: 32px;
    width: 100%;
    min-width: 0;
}

.officials-row {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 40px;
    padding: 0 20px;
    width: 100%;
    min-width: 0;
}

.captain-row {
    display: flex;
    justify-content: center;
}

.captain-row .official-card {
    width: 280px;
}

.dual-row {
    display: flex;
    justify-content: center;
    gap: 48px;
}

.dual-row .official-card {
    width: 280px;
}

.kagawad-row {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 40px;
    max-width: 1000px;
    margin: 0 auto;
    width: 100%;
}

.other-row {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 40px;
}

.official-card {
    display: grid;
    gap: 20px;
    align-items: center;
    text-align: center;
    padding: 22px 18px;
    min-width: 0;
    max-width: 100%;
    background: #ffffff;
    border: 1px solid rgba(221, 229, 239, 0.9);
    border-radius: 18px;
    box-shadow: 0 16px 36px rgba(22, 36, 26, 0.11), 0 4px 12px rgba(22, 36, 26, 0.05);
    transition: transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease;
}

.official-card:hover {
    transform: translateY(-3px);
    border-color: rgba(46, 117, 82, 0.22);
    box-shadow: 0 22px 46px rgba(22, 36, 26, 0.16), 0 8px 20px rgba(46, 117, 82, 0.08);
}

.official-avatar {
    width: 140px;
    height: 140px;
    border-radius: 50%;
    margin: 0 auto;
    background: #e9f2ec;
    background-size: cover;
    background-position: center;
    display: grid;
    place-items: center;
    color: #2f4f3c;
    font-size: 1.8rem;
    font-weight: 700;
    letter-spacing: 0.08em;
}

.official-copy strong {
    display: block;
    font-size: 1.1rem;
    margin-bottom: 6px;
    font-weight: 600;
    color: #1a1a1a;
}

.official-copy small {
    color: #5e6f66;
    font-size: 0.95rem;
    display: block;
}

.officials-loading,
.empty-state {
    text-align: center;
    color: #55635a;
    font-size: 1rem;
    padding: 40px 20px;
}

@media (max-width: 1024px) {
    .kagawad-row {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 32px;
        max-width: 100%;
    }
}

@media (max-width: 768px) {
    .landing-officials-section {
        padding: 48px 14px;
    }

    .officials-row {
        gap: 32px;
        padding: 0;
    }

    .dual-row .official-card {
        width: min(240px, 100%);
    }

    .captain-row .official-card {
        width: min(240px, 100%);
    }

    .kagawad-row {
        grid-template-columns: repeat(2, minmax(0, 180px));
        justify-content: center;
        gap: 20px;
    }

    .official-avatar {
        width: 120px;
        height: 120px;
        font-size: 1.5rem;
    }

    .official-copy strong {
        font-size: 1rem;
    }
}

@media (max-width: 480px) {
    .officials-sections {
        gap: 32px;
        margin-top: 24px;
    }

    .officials-row {
        gap: 20px;
        padding: 0;
    }

    .dual-row {
        gap: 16px;
    }

    .dual-row .official-card {
        width: min(160px, calc(50vw - 18px));
    }

    .captain-row .official-card {
        width: min(180px, 100%);
    }

    .kagawad-row {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
    }

    .kagawad-row .official-card,
    .other-row .official-card {
        width: 100%;
    }

    .official-avatar {
        width: 100px;
        height: 100px;
        font-size: 1.3rem;
    }

    .official-copy strong {
        font-size: 0.9rem;
    }

    .official-copy small {
        font-size: 0.85rem;
    }
}
</style>

<style scoped>
/* VMG Cards */
    .landing-vmg-section {
    width: 100%;
    max-width: 1520px;
    margin: 0 auto;
    padding: 48px 28px 72px;
    overflow-x: auto;
}
.vmg-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 28px;
    align-items: stretch;
    margin-top: 20px;
    width: 100%;
    min-width: 0;
}
.vmg-card {
    position: relative;
    overflow: hidden;
    min-height: 320px;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    border-radius: 14px;
    background: transparent;
    min-width: 0;
    max-width: 100%;
    box-shadow: 0 18px 44px rgba(22, 36, 26, 0.14), 0 6px 16px rgba(22, 36, 26, 0.07);
    transition: transform 180ms ease, box-shadow 180ms ease;
}
.vmg-card:hover {
    transform: translateY(-3px);
    box-shadow: 0 24px 56px rgba(22, 36, 26, 0.18), 0 8px 22px rgba(39, 174, 96, 0.1);
}
.vmg-card .vmg-card-bg {
    position: absolute;
    inset: 0;
    background-image: url('/images/hero-logo.png');
    background-repeat: no-repeat;
    background-position: center;
    background-size: 200px 200px;
    filter: saturate(0.9) brightness(0.95);
    opacity: 0.95;
}
.vmg-overlay {
    position: absolute;
    inset: 0;
    background: rgba(255,255,255,0.88);
    display: block;
    border-radius: inherit;
}
.vmg-copy { position: relative; padding: 36px 28px; z-index: 6; }
.vmg-copy h4 { margin: 0 0 12px; font-size: 1.05rem; letter-spacing: .08em; }
.vmg-copy p { margin: 0; font-size: 0.95rem; line-height: 1.45; color: #1b1b1b; }

/* waves */
.vmg-wave {
    position: absolute;
    left: 0;
    right: 0;
    height: 48px;
    background-repeat: no-repeat;
    background-position: center;
    background-size: cover;
}
.vmg-wave.top { top: 0; z-index: 5; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 120' preserveAspectRatio='none'><path d='M0,0 C150,70 350,70 600,30 C850,-10 1050,30 1200,60 L1200,0 L0,0 Z' fill='%2327ae60'/></svg>"); }
.vmg-wave.bottom { bottom: 0; z-index: 5; transform: rotate(180deg); background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 120' preserveAspectRatio='none'><path d='M0,0 C150,70 350,70 600,30 C850,-10 1050,30 1200,60 L1200,0 L0,0 Z' fill='%2327ae60'/></svg>"); }
.vmg-wave.outer.top { z-index: 4; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 120' preserveAspectRatio='none'><path d='M0,0 C150,80 350,80 600,40 C850,0 1050,40 1200,80 L1200,0 L0,0 Z' fill='%23f1c40f' opacity='0.95'/></svg>"); }
.vmg-wave.outer.bottom { z-index: 4; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 120' preserveAspectRatio='none'><path d='M0,0 C150,80 350,80 600,40 C850,0 1050,40 1200,80 L1200,0 L0,0 Z' fill='%23f1c40f' opacity='0.95'/></svg>"); }

/* responsive */
@media (max-width: 992px) {
    .vmg-grid { grid-template-columns: repeat(2, 1fr); }

    .privacy-header {
        padding: 24px 24px;
    }

    .privacy-header h2 {
        font-size: 1.5rem;
    }

    .privacy-content {
        padding: 0 24px;
        max-height: calc(90vh - 180px);
    }

    .privacy-footer {
        padding: 20px 24px;
    }
}
@media (max-width: 640px) {
    .landing-vmg-section {
        padding: 40px 14px 56px;
    }

    .vmg-grid { grid-template-columns: 1fr; gap: 20px; }
    .vmg-card { min-height: 260px; }

    .privacy-header {
        padding: 20px 16px;
        flex-direction: column;
        align-items: flex-start;
        gap: 12px;
    }

    .privacy-header h2 {
        font-size: 1.2rem;
    }

    .privacy-close-btn {
        align-self: flex-end;
    }

    .privacy-content {
        padding: 0 16px;
        max-height: calc(90vh - 160px);
    }

    .privacy-section {
        margin-bottom: 20px;
    }

    .privacy-section h3 {
        font-size: 1rem;
    }

    .privacy-section p,
    .privacy-section ul {
        font-size: 0.9rem;
    }

    .privacy-footer {
        padding: 16px;
    }
}
</style>
