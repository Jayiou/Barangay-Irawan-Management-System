const test = require('node:test');
const assert = require('node:assert/strict');

const sms = require('../utils/sms');

class FakeSmsLog {
    static records = [];

    constructor(payload) {
        this.payload = payload;
    }

    async save() {
        FakeSmsLog.records.push(this.payload);
        return this;
    }

    static reset() {
        FakeSmsLog.records = [];
    }
}

const logger = {
    logMessages: [],
    warnMessages: [],
    errorMessages: [],
    log(...args) {
        this.logMessages.push(args);
    },
    warn(...args) {
        this.warnMessages.push(args);
    },
    error(...args) {
        this.errorMessages.push(args);
    }
};

const restoreSmsRuntime = () => {
    sms.resetSmsRuntime();
    FakeSmsLog.reset();
    logger.logMessages = [];
    logger.warnMessages = [];
    logger.errorMessages = [];
};

test.afterEach(restoreSmsRuntime);

test('sendDocumentStatusSMS sends a compact SMS through Twilio and records success', async () => {
    const createCalls = [];
    const fakeClient = {
        messages: {
            create: async (payload) => {
                createCalls.push(payload);
                return { sid: 'SM123', status: 'queued' };
            }
        }
    };

    sms.configureSmsRuntime({
        env: {
            SMS_ENABLED: 'true',
            TWILIO_ACCOUNT_SID: 'AC123',
            TWILIO_AUTH_TOKEN: 'token',
            TWILIO_NUMBER: '+15550001111'
        },
        smsLogModel: FakeSmsLog,
        twilioClientFactory: () => fakeClient,
        logger
    });

    const result = await sms.sendDocumentStatusSMS(
        '+15550002222',
        'Prince',
        'barangay_clearance',
        'approved',
        'DOC-123'
    );

    assert.equal(result.sent, true);
    assert.equal(result.messageSid, 'SM123');
    assert.equal(createCalls.length, 1);
    assert.deepEqual(createCalls[0], {
        body: 'Brgy Irawan: Hi Prince, your Barangay Clearance request is APPROVED. Please check your email for full details. Ref: DOC-123',
        from: '+15550001111',
        to: '+15550002222'
    });
    assert.equal(FakeSmsLog.records.length, 1);
    assert.equal(FakeSmsLog.records[0].status, 'sent');
    assert.equal(FakeSmsLog.records[0].providerMessageId, 'SM123');
});

test('sendSmsNotification records a failed log when Twilio credentials are missing', async () => {
    sms.configureSmsRuntime({
        env: { SMS_ENABLED: 'true' },
        smsLogModel: FakeSmsLog,
        logger
    });

    const result = await sms.sendSmsNotification({
        phoneNumber: '+15550002222',
        messageType: 'resident_update',
        messageContent: 'Brgy Irawan: Hi Prince, your account is APPROVED. Please check your email for full details.'
    });

    assert.equal(result.sent, false);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'missing_config');
    assert.equal(FakeSmsLog.records.length, 1);
    assert.equal(FakeSmsLog.records[0].status, 'failed');
    assert.equal(FakeSmsLog.records[0].providerStatus, 'missing_config');
    assert.match(FakeSmsLog.records[0].providerError, /Twilio credentials are missing/i);
    assert.equal(logger.warnMessages.length > 0, true);
});

test('sendSmsNotification returns mocked success when SMS_MOCK is enabled', async () => {
    sms.configureSmsRuntime({
        env: { SMS_MOCK: 'true' },
        smsLogModel: FakeSmsLog,
        logger
    });

    const result = await sms.sendSmsNotification({
        phoneNumber: '+15550002222',
        messageType: 'resident_update',
        messageContent: 'Brgy Irawan: Hi Prince, this is a mock test message.'
    });

    assert.equal(result.sent, true);
    assert.equal(result.mocked, true);
    assert.equal(result.provider, 'mock');
    assert.equal(FakeSmsLog.records.length, 1);
    assert.equal(FakeSmsLog.records[0].status, 'mocked');
    assert.equal(FakeSmsLog.records[0].provider, 'mock');
    assert.equal(FakeSmsLog.records[0].providerStatus, 'mock');
});

test('sendStatusUpdateSMS records a failed log when Twilio returns an error', async () => {
    const fakeClient = {
        messages: {
            create: async () => {
                const error = new Error('Twilio rejected the request');
                error.code = 21211;
                error.status = 400;
                throw error;
            }
        }
    };

    sms.configureSmsRuntime({
        env: {
            SMS_ENABLED: 'true',
            TWILIO_ACCOUNT_SID: 'AC123',
            TWILIO_AUTH_TOKEN: 'token',
            TWILIO_NUMBER: '+15550001111'
        },
        smsLogModel: FakeSmsLog,
        twilioClientFactory: () => fakeClient,
        logger
    });

    const result = await sms.sendStatusUpdateSMS('+15550002222', 'Prince', 'approved');

    assert.equal(result.sent, false);
    assert.equal(Boolean(result.error), true);
    assert.equal(FakeSmsLog.records.length, 1);
    assert.equal(FakeSmsLog.records[0].status, 'failed');
    assert.equal(FakeSmsLog.records[0].providerErrorCode, '21211');
    assert.equal(FakeSmsLog.records[0].providerStatus, '400');
});

test('sendSmsNotification normalizes PH local numbers to E.164 before Twilio send', async () => {
    const createCalls = [];
    const fakeClient = {
        messages: {
            create: async (payload) => {
                createCalls.push(payload);
                return { sid: 'SM456', status: 'queued' };
            }
        }
    };

    sms.configureSmsRuntime({
        env: {
            SMS_ENABLED: 'true',
            TWILIO_ACCOUNT_SID: 'AC123',
            TWILIO_AUTH_TOKEN: 'token',
            TWILIO_NUMBER: '+15550001111'
        },
        smsLogModel: FakeSmsLog,
        twilioClientFactory: () => fakeClient,
        logger
    });

    const result = await sms.sendSmsNotification({
        phoneNumber: '09300620000',
        messageType: 'document_status',
        messageContent: 'Brgy Irawan: test notification.'
    });

    assert.equal(result.sent, true);
    assert.equal(createCalls.length, 1);
    assert.equal(createCalls[0].to, '+639300620000');
    assert.equal(FakeSmsLog.records.length, 1);
    assert.equal(FakeSmsLog.records[0].phoneNumber, '+639300620000');
});

test('sendSmsNotification skips invalid phone number and does not call Twilio', async () => {
    const createCalls = [];
    const fakeClient = {
        messages: {
            create: async (payload) => {
                createCalls.push(payload);
                return { sid: 'SM789', status: 'queued' };
            }
        }
    };

    sms.configureSmsRuntime({
        env: {
            SMS_ENABLED: 'true',
            TWILIO_ACCOUNT_SID: 'AC123',
            TWILIO_AUTH_TOKEN: 'token',
            TWILIO_NUMBER: '+15550001111'
        },
        smsLogModel: FakeSmsLog,
        twilioClientFactory: () => fakeClient,
        logger
    });

    const result = await sms.sendSmsNotification({
        phoneNumber: '0930062XXXX',
        messageType: 'document_status',
        messageContent: 'Brgy Irawan: test notification.'
    });

    assert.equal(result.sent, false);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'invalid_recipient');
    assert.equal(createCalls.length, 0);
    assert.equal(FakeSmsLog.records.length, 1);
    assert.equal(FakeSmsLog.records[0].status, 'failed');
    assert.equal(FakeSmsLog.records[0].providerStatus, 'invalid_recipient');
});

test('sendSmsNotification uses messagingServiceSid when configured', async () => {
    const createCalls = [];
    const fakeClient = {
        messages: {
            create: async (payload) => {
                createCalls.push(payload);
                return { sid: 'SM999', status: 'queued' };
            }
        }
    };

    sms.configureSmsRuntime({
        env: {
            SMS_ENABLED: 'true',
            TWILIO_ACCOUNT_SID: 'AC123',
            TWILIO_AUTH_TOKEN: 'token',
            TWILIO_MESSAGING_SERVICE_SID: 'MG1234567890abcdef1234567890abcdef'
        },
        smsLogModel: FakeSmsLog,
        twilioClientFactory: () => fakeClient,
        logger
    });

    const result = await sms.sendSmsNotification({
        phoneNumber: '+639300625493',
        messageType: 'document_status',
        messageContent: 'Brgy Irawan: test messaging service.'
    });

    assert.equal(result.sent, true);
    assert.equal(createCalls.length, 1);
    assert.equal(createCalls[0].messagingServiceSid, 'MG1234567890abcdef1234567890abcdef');
    assert.equal(createCalls[0].from, undefined);
    assert.equal(createCalls[0].to, '+639300625493');
});

test('sendSmsNotification sends through IPROG and records the message ID', async () => {
    const fetchCalls = [];
    const fakeFetch = async (url, options) => {
        fetchCalls.push({ url, options });
        return {
            ok: true,
            status: 200,
            json: async () => ({
                status: 200,
                message: 'Queued',
                message_id: 'iSms-XHYBk'
            })
        };
    };

    sms.configureSmsRuntime({
        env: {
            SMS_ENABLED: 'true',
            SMS_PROVIDER: 'iprog',
            IPROG_API_TOKEN: 'secret-token'
        },
        smsLogModel: FakeSmsLog,
        fetch: fakeFetch,
        logger
    });

    const result = await sms.sendSmsNotification({
        phoneNumber: '09300620000',
        messageType: 'resident_update',
        messageContent: 'Brgy Irawan: Your account was updated.'
    });

    assert.equal(result.sent, true);
    assert.equal(result.provider, 'iprog');
    assert.equal(result.messageId, 'iSms-XHYBk');
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, 'https://www.iprogsms.com/api/v1/sms_messages');
    assert.deepEqual(JSON.parse(fetchCalls[0].options.body), {
        api_token: 'secret-token',
        phone_number: '639300620000',
        message: 'Brgy Irawan: Your account was updated.'
    });
    assert.equal(FakeSmsLog.records[0].provider, 'iprog');
    assert.equal(FakeSmsLog.records[0].providerMessageId, 'iSms-XHYBk');
});

test('sendSmsNotification reports missing IPROG token without making a request', async () => {
    let fetchCalled = false;
    sms.configureSmsRuntime({
        env: {
            SMS_ENABLED: 'true',
            SMS_PROVIDER: 'iprog'
        },
        smsLogModel: FakeSmsLog,
        fetch: async () => {
            fetchCalled = true;
        },
        logger
    });

    const result = await sms.sendSmsNotification({
        phoneNumber: '09300620000',
        messageType: 'resident_update',
        messageContent: 'Test'
    });

    assert.equal(result.sent, false);
    assert.equal(result.reason, 'missing_config');
    assert.equal(fetchCalled, false);
    assert.equal(FakeSmsLog.records[0].provider, 'iprog');
    assert.match(FakeSmsLog.records[0].providerError, /IPROG SMS credentials/i);
});

test('sendSmsNotification records an IPROG API rejection', async () => {
    sms.configureSmsRuntime({
        env: {
            SMS_ENABLED: 'true',
            SMS_PROVIDER: 'iprog',
            IPROG_API_TOKEN: 'invalid-token'
        },
        smsLogModel: FakeSmsLog,
        fetch: async () => ({
            ok: false,
            status: 401,
            json: async () => ({ status: 500, message: 'Invalid Token' })
        }),
        logger
    });

    const result = await sms.sendSmsNotification({
        phoneNumber: '09300620000',
        messageType: 'resident_update',
        messageContent: 'Test'
    });

    assert.equal(result.sent, false);
    assert.equal(FakeSmsLog.records[0].status, 'failed');
    assert.equal(FakeSmsLog.records[0].provider, 'iprog');
    assert.equal(FakeSmsLog.records[0].providerStatus, '401');
    assert.equal(FakeSmsLog.records[0].providerError, 'Invalid Token');
    assert.equal(FakeSmsLog.records[0].providerErrorCode, '500');
});
