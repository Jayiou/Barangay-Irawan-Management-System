const twilio = require('twilio');
const SMSLog = require('../models/SMSLog');

const smsRuntime = {
    env: process.env,
    logger: console,
    smsLogModel: SMSLog,
    fetch: null,
    twilioClientFactory: null,
    twilioClient: null
};

const configureSmsRuntime = (overrides = {}) => {
    Object.assign(smsRuntime, overrides);
};

const resetSmsRuntime = () => {
    smsRuntime.env = process.env;
    smsRuntime.logger = console;
    smsRuntime.smsLogModel = SMSLog;
    smsRuntime.fetch = null;
    smsRuntime.twilioClientFactory = null;
    smsRuntime.twilioClient = null;
};

const getEnv = () => smsRuntime.env || process.env;
const getLogger = () => smsRuntime.logger || console;

const logAtLevel = (level, ...args) => {
    const logger = getLogger();
    const loggerMethod = logger[level] || logger.log || console.log;
    return loggerMethod.apply(logger, args);
};

// Truncate messages to single-SMS limits to reduce billing/credits.
const isBasicAscii = (text) => /^[\x00-\x7F]*$/.test(String(text || ''));
const singleSegmentLimit = (text) => (isBasicAscii(text) ? 160 : 70);
const truncateToSingleSegment = (text) => {
    const value = String(text || '');
    const limit = singleSegmentLimit(value);
    if (value.length <= limit) return value;
    return value.slice(0, Math.max(0, limit - 3)) + '...';
};

const formatLabel = (text) => {
    if (!text) return text;
    return text
    .split('_')
    .join(' ')
        .split(' ')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
};

const normalizePhoneNumber = (value) => String(value || '')
    .replace(/[\s()-]/g, '')
    .trim();

const toE164PhoneNumber = (value) => {
    const normalized = normalizePhoneNumber(value);
    if (!normalized) return '';

    // Keep only leading plus and digits for provider-safe parsing.
    const cleaned = normalized
        .replace(/(?!^)[+]/g, '')
        .replace(/[^\d+]/g, '');

    if (!cleaned) return '';

    let candidate = cleaned;

    // Handle international prefix format like 0063...
    if (candidate.startsWith('00')) {
        candidate = '+' + candidate.slice(2);
    }

    // Common PH local formats: 09XXXXXXXXX or 9XXXXXXXXX
    if (/^09\d{9}$/.test(candidate)) {
        candidate = '+63' + candidate.slice(1);
    } else if (/^9\d{9}$/.test(candidate)) {
        candidate = '+63' + candidate;
    } else if (/^63\d{10}$/.test(candidate)) {
        candidate = '+' + candidate;
    }

    // Strict E.164 validation after normalization.
    if (!/^\+[1-9]\d{7,14}$/.test(candidate)) {
        return '';
    }

    return candidate;
};

const getSmsProvider = () => String(getEnv().SMS_PROVIDER || getEnv().SMS_MODE || 'twilio').trim().toLowerCase();
const isSmsEnabled = () => String(getEnv().SMS_ENABLED || '').toLowerCase() === 'true';
const isSmsMockEnabled = () => String(getEnv().SMS_MOCK || '').toLowerCase() === 'true' || getSmsProvider() === 'mock';

const getIprogConfig = () => {
    const env = getEnv();
    const apiToken = String(env.IPROG_API_TOKEN || '').trim();
    const endpoint = String(env.IPROG_SMS_ENDPOINT || 'https://www.iprogsms.com/api/v1/sms_messages').trim();
    const smsProvider = String(env.IPROG_SMS_PROVIDER || '').trim();

    return {
        apiToken,
        endpoint,
        smsProvider,
        isConfigured: Boolean(apiToken && endpoint)
    };
};

const getTwilioConfig = () => {
    const env = getEnv();
    const accountSid = String(env.TWILIO_ACCOUNT_SID || '').trim();
    const authToken = String(env.TWILIO_AUTH_TOKEN || '').trim();
    const fromNumber = String(env.TWILIO_NUMBER || '').trim();
    const messagingServiceSid = String(env.TWILIO_MESSAGING_SERVICE_SID || '').trim();

    return {
        accountSid,
        authToken,
        fromNumber,
        messagingServiceSid,
        isConfigured: Boolean(accountSid && authToken && (fromNumber || messagingServiceSid))
    };
};

const getTwilioClient = () => {
    if (smsRuntime.twilioClient) {
        return smsRuntime.twilioClient;
    }

    if (typeof smsRuntime.twilioClientFactory === 'function') {
        smsRuntime.twilioClient = smsRuntime.twilioClientFactory();
        return smsRuntime.twilioClient;
    }

    const { accountSid, authToken } = getTwilioConfig();
    smsRuntime.twilioClient = twilio(accountSid, authToken);
    return smsRuntime.twilioClient;
};

const saveSmsLog = async ({
    phoneNumber,
    messageType,
    messageContent,
    status,
    recipientId,
    referenceId = '',
    provider = 'twilio',
    providerMessageId = '',
    providerStatus = '',
    providerError = '',
    providerErrorCode = ''
}) => {
    const smsLogModel = smsRuntime.smsLogModel || SMSLog;
    const smsLog = new smsLogModel({
        phoneNumber,
        messageType,
        messageContent,
        recipientId,
        referenceId,
        status,
        provider,
        providerMessageId,
        providerStatus,
        providerError,
        providerErrorCode
    });

    return smsLog.save();
};

const buildTwilioMessagePayload = (twilioConfig, finalPhoneNumber, truncatedMessage) => {
    const messagePayload = {
        body: truncatedMessage,
        to: finalPhoneNumber
    };

    if (twilioConfig.messagingServiceSid) {
        messagePayload.messagingServiceSid = twilioConfig.messagingServiceSid;
    } else {
        messagePayload.from = twilioConfig.fromNumber;
    }

    return messagePayload;
};

const getSmsProviderErrorDetails = (error) => {
    const providerStatus = error?.status ? String(error.status) : 'error';
    const providerErrorCode = error?.code === undefined || error?.code === null ? '' : String(error.code);
    let providerError = 'Unknown SMS provider error';

    if (error?.code === 21612) {
        providerError = 'Twilio rejected the sender/recipient combination. Use a Messaging Service sender allowed for the destination country.';
    } else if (error?.message) {
        providerError = error.message;
    }

    return {
        providerStatus,
        providerError,
        providerErrorCode
    };
};

const sendWithIprog = async (finalPhoneNumber, truncatedMessage) => {
    const config = getIprogConfig();
    const fetchImpl = smsRuntime.fetch || globalThis.fetch;

    if (typeof fetchImpl !== 'function') {
        const error = new Error('The server runtime does not support fetch');
        error.code = 'FETCH_UNAVAILABLE';
        throw error;
    }

    const payload = {
        api_token: config.apiToken,
        phone_number: finalPhoneNumber.replace(/^\+/, ''),
        message: truncatedMessage
    };

    if (config.smsProvider) {
        payload.sms_provider = Number(config.smsProvider);
    }

    const response = await fetchImpl(config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const responseBody = await response.json().catch(() => ({}));
    const apiStatus = responseBody?.status;
    const accepted = response.ok && (apiStatus === 200 || String(apiStatus).toLowerCase() === 'success');

    if (!accepted) {
        const error = new Error(responseBody?.message || `IPROG SMS request failed with HTTP ${response.status}`);
        error.status = response.status;
        error.code = responseBody?.code || apiStatus || response.status;
        throw error;
    }

    return {
        messageId: responseBody?.message_id || '',
        status: 'queued'
    };
};

const sendSmsNotification = async ({
    phoneNumber,
    messageType,
    messageContent,
    recipientId,
    referenceId = ''
}) => {
    const smsMock = isSmsMockEnabled();
    if (!smsMock && !isSmsEnabled()) {
        logAtLevel('log', 'SMS is disabled. Skipping SMS send.');
        return { sent: false, skipped: true, reason: 'disabled' };
    }

    const finalPhoneNumber = toE164PhoneNumber(phoneNumber);
    const truncatedMessage = truncateToSingleSegment(messageContent);

    if (!finalPhoneNumber) {
        const errorMessage = 'Recipient phone number is missing or invalid. Use E.164 format (e.g. +639XXXXXXXXX).';
        await saveSmsLog({
            phoneNumber: normalizePhoneNumber(phoneNumber),
            messageType,
            messageContent: truncatedMessage,
            recipientId,
            referenceId,
            status: 'failed',
            providerStatus: 'invalid_recipient',
            providerError: errorMessage
        });
        logAtLevel('warn', `[SMS] Invalid phone number for ${messageType}. Expected E.164, got: "${phoneNumber || ''}"`);
        return { sent: false, skipped: true, reason: 'invalid_recipient' };
    }

    if (smsMock) {
        // Persist mocked sends only when a test/runtime explicitly supplies a log model.
        if (smsRuntime.smsLogModel !== SMSLog) {
            await saveSmsLog({
                phoneNumber: finalPhoneNumber,
                messageType,
                messageContent: truncatedMessage,
                recipientId,
                referenceId,
                status: 'mocked',
                provider: 'mock',
                providerMessageId: 'mocked',
                providerStatus: 'mock'
            });
        }
        logAtLevel('log', `[SMS] Mock SMS send for ${messageType} to ${finalPhoneNumber}`);
        return {
            sent: true,
            mocked: true,
            phoneNumber: finalPhoneNumber,
            messageType,
            messageContent: truncatedMessage,
            provider: 'mock'
        };
    }

    const provider = getSmsProvider();
    const providerConfig = provider === 'iprog' ? getIprogConfig() : getTwilioConfig();
    if (!providerConfig.isConfigured) {
        const providerName = provider === 'iprog' ? 'IPROG SMS' : 'Twilio';
        const errorMessage = `${providerName} credentials are missing or incomplete`;
        await saveSmsLog({
            phoneNumber: finalPhoneNumber,
            messageType,
            messageContent: truncatedMessage,
            recipientId,
            referenceId,
            status: 'failed',
            provider,
            providerStatus: 'missing_config',
            providerError: errorMessage
        });
        logAtLevel('warn', `[SMS] ${errorMessage}. SMS send skipped.`);
        return { sent: false, skipped: true, reason: 'missing_config' };
    }

    try {
        let providerMessageId = '';
        let providerStatus = 'queued';

        if (provider === 'iprog') {
            const result = await sendWithIprog(finalPhoneNumber, truncatedMessage);
            providerMessageId = result.messageId;
            providerStatus = result.status;
        } else {
            const client = getTwilioClient();
            const result = await client.messages.create(buildTwilioMessagePayload(providerConfig, finalPhoneNumber, truncatedMessage));
            providerMessageId = result?.sid || '';
            providerStatus = result?.status || 'queued';
        }

        await saveSmsLog({
            phoneNumber: finalPhoneNumber,
            messageType,
            messageContent: truncatedMessage,
            recipientId,
            referenceId,
            status: 'sent',
            provider,
            providerMessageId,
            providerStatus
        });

        const idText = providerMessageId ? ' (ID: ' + providerMessageId + ')' : '';
        logAtLevel('log', `[SMS] ${messageType} sent through ${provider} to ${finalPhoneNumber}${idText}`);
        return {
            sent: true,
            provider,
            messageId: providerMessageId,
            messageSid: provider === 'twilio' ? providerMessageId : '',
            providerStatus,
            messageContent: truncatedMessage
        };
    } catch (error) {
        const {
            providerStatus,
            providerError,
            providerErrorCode
        } = getSmsProviderErrorDetails(error);

        await saveSmsLog({
            phoneNumber: finalPhoneNumber,
            messageType,
            messageContent: truncatedMessage,
            recipientId,
            referenceId,
            status: 'failed',
            provider,
            providerStatus,
            providerError,
            providerErrorCode
        });

        logAtLevel('error', `Error sending ${messageType} SMS:`, error);
        return { sent: false, error };
    }
};

const sendDocumentStatusSMS = async (phoneNumber, name, documentType, status, referenceNumber) => {
    const docTypeFormatted = formatLabel(documentType);

    let messageContent = '';
    if (status === 'approved') {
        const referenceText = referenceNumber ? ' Ref: ' + referenceNumber : '';
        messageContent = `Brgy Irawan: Hi ${name}, your ${docTypeFormatted} request is APPROVED. Please check your email for full details.${referenceText}`;
    } else if (status === 'processing') {
        messageContent = `Brgy Irawan: Hi ${name}, your ${docTypeFormatted} request is PROCESSING. Please check your email for full details.`;
    } else if (status === 'ready_for_pickup') {
        messageContent = `Brgy Irawan: Hi ${name}, your ${docTypeFormatted} is READY FOR PICKUP. Please check your email for full details.`;
    } else if (status === 'rejected') {
        messageContent = `Brgy Irawan: Hi ${name}, your ${docTypeFormatted} request was REJECTED. Please check your email for full details.`;
    } else if (status === 'completed') {
        messageContent = `Brgy Irawan: Hi ${name}, your ${docTypeFormatted} request is COMPLETED. Please check your email for full details.`;
    } else {
        return { sent: false, skipped: true, reason: 'unsupported_status' };
    }

    return sendSmsNotification({
        phoneNumber,
        messageType: 'document_status',
        messageContent,
        referenceId: referenceNumber
    });
};

const sendStatusUpdateSMS = async (phoneNumber, name, status) => {
    let messageContent = '';

    if (status === 'approved') {
        messageContent = `Brgy Irawan: Hi ${name}, your account is APPROVED. Please check your email for full details.`;
    } else if (status === 'rejected') {
        messageContent = `Brgy Irawan: Hi ${name}, your account is REJECTED. Please check your email for full details.`;
    } else {
        return { sent: false, skipped: true, reason: 'unsupported_status' };
    }

    return sendSmsNotification({
        phoneNumber,
        messageType: 'resident_approval',
        messageContent
    });
};

const sendAppointmentSMS = async (phoneNumber, name, appointmentDate, appointmentTime, purpose) => {
    const messageContent = `Brgy Irawan: Hi ${name}, your Appointment request on ${appointmentDate} ${appointmentTime} is ${purpose || 'scheduled'}. Please check your email for full details. Ref: Appointment`;

    return sendSmsNotification({
        phoneNumber,
        messageType: 'appointment_confirmation',
        messageContent
    });
};

const sendRequestStatusSMS = async (phoneNumber, name, requestLabel, status, options = {}) => {
    const humanStatus = formatLabel(status);
    const referenceText = options.referenceId ? ` Ref: ${options.referenceId}` : '';
    const messageContent = `Brgy Irawan: Hi ${name}, your ${requestLabel} is ${humanStatus}. Please check your email for full details.${referenceText}`;

    return sendSmsNotification({
        phoneNumber,
        messageType: options.messageType || 'resident_update',
        messageContent,
        recipientId: options.recipientId,
        referenceId: options.referenceId || ''
    });
};

const sendOtpSMS = async (phoneNumber, otpCode) => sendSmsNotification({
    phoneNumber,
    messageType: 'registration_otp',
    messageContent: `Brgy Irawan: Your registration OTP is ${otpCode}. It expires in 10 minutes. Do not share this code.`
});

module.exports = {
    sendSmsNotification,
    sendDocumentStatusSMS,
    sendStatusUpdateSMS,
    sendAppointmentSMS,
    sendRequestStatusSMS,
    sendOtpSMS,
    formatLabel,
    truncateToSingleSegment,
    configureSmsRuntime,
    resetSmsRuntime
};
