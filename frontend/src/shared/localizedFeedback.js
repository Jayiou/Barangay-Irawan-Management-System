const MESSAGE_KEYS = {
    'Date cannot be in the future.': 'common.feedback.dateFuture',
    'Please complete all password requirements.': 'common.feedback.passwordRequirements',
    'New passwords do not match.': 'common.feedback.passwordMismatch',
    'Please upload at least one proof image for this report type.': 'common.feedback.proofRequired',
    'Date is required for this report type.': 'common.feedback.dateRequired',
    'Geolocation is not supported on this device/browser.': 'common.feedback.geolocationUnsupported',
    'Current location captured.': 'common.feedback.locationCaptured',
    'Location captured (lower accuracy mode).': 'common.feedback.locationCapturedLowAccuracy',
    'Appointment requested successfully!': 'common.feedback.appointmentSubmitted',
    'Appointment cancelled.': 'common.feedback.appointmentCancelled',
    'Manpower request cancelled.': 'common.feedback.manpowerCancelled',
    'Password updated successfully.': 'common.feedback.passwordUpdated',
    'Gmail updated successfully.': 'common.feedback.gmailUpdated',
    'Please enter at least 1 personnel needed.': 'common.feedback.personnelRequired',
    'Please complete your resident profile before joining a queue.': 'common.feedback.profileRequired',
    'You are already in this queue.': 'common.feedback.alreadyInQueue',
    'Successfully joined queue.': 'common.feedback.queueJoined'
};

export const localizeFeedbackMessage = ({ message, isError = false, locale, t }) => {
    const normalizedMessage = String(message || '').trim();
    if (!normalizedMessage || locale !== 'tl') {
        return normalizedMessage;
    }

    const key = MESSAGE_KEYS[normalizedMessage];
    if (key) {
        return t(key);
    }

    return isError ? t('common.feedback.requestFailed') : normalizedMessage;
};
