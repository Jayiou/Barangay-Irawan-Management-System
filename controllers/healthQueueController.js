const HealthQueue = require('../models/HealthQueue');
const HealthEvent = require('../models/HealthEvent');
const Resident = require('../models/Resident');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const { createHttpError } = require('../utils/httpError');
const mailer = require('../utils/mailer');
const { sendSmsNotification } = require('../utils/sms');

const pad = (n, width = 3) => String(n).padStart(width, '0');
const TERMINAL_QUEUE_STATUSES = ['completed', 'no-show', 'cancelled'];
const STATUS_TRANSITIONS = new Set(['waiting', 'serving', ...TERMINAL_QUEUE_STATUSES]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_STATUS_TRANSITIONS = {
    waiting: new Set(['serving', 'cancelled', 'no-show']),
    serving: new Set(['completed', 'no-show', 'cancelled']),
    completed: new Set(),
    'no-show': new Set(),
    cancelled: new Set()
};

const getUserId = (req) => req.user?._id || req.user?.id;
const isQueueStaff = (req) => ['admin', 'bhw'].includes(req.user?.role);
const sameId = (a, b) => a && b && String(a) === String(b);
const deliveryStatus = (emailResult) => ({
    emailSent: Boolean(emailResult?.sent),
    emailReason: emailResult?.sent ? '' : (emailResult?.reason || emailResult?.error?.message || 'send_failed')
});

const toQueueItem = (item, { staff = false, residentId = null } = {}) => {
    if (!item) return null;
    const isMine = sameId(item.residentId, residentId);
    const base = {
        _id: item._id,
        queueNumber: item.queueNumber,
        queueCode: item.queueCode,
        status: item.status,
        isMine
    };

    if (!staff) return base;

    return {
        ...base,
        requesterType: item.requesterType,
        residentId: item.residentId,
        userId: item.userId,
        firstName: item.firstName,
        lastName: item.lastName,
        contactNumber: item.contactNumber,
        email: item.email,
        notifiedApproaching: item.notifiedApproaching,
        notifiedTurn: item.notifiedTurn,
        servedAt: item.servedAt,
        completedAt: item.completedAt,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
    };
};

const buildQueueSummary = (items, event, viewer = {}) => {
    const counts = items.reduce((acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
    }, {});
    const current = items.find((item) => item.status === 'serving') || null;
    const next = items.find((item) => item.status === 'waiting') || null;

    return {
        total: items.length,
        waiting: counts.waiting || 0,
        serving: counts.serving || 0,
        completed: counts.completed || 0,
        noShow: counts['no-show'] || 0,
        cancelled: counts.cancelled || 0,
        currentServing: event?.currentServing || 0,
        isQueueOpen: Boolean(event?.isQueueOpen),
        current: toQueueItem(current, viewer),
        next: toQueueItem(next, viewer)
    };
};

const getQueueWithSummary = async (eventId, viewer = {}) => {
    const [event, items] = await Promise.all([
        HealthEvent.findById(eventId),
        HealthQueue.find({ eventId }).sort({ queueNumber: 1 })
    ]);

    if (!event) throw createHttpError(404, 'Event not found');
    return { event, items, summary: buildQueueSummary(items, event, viewer) };
};

const getResidentForRequest = async (req) => {
    const userId = getUserId(req);
    if (!userId) throw createHttpError(401, 'Authentication is required');

    const resident = await Resident.findOne({ userId });
    if (!resident) {
        throw createHttpError(404, 'Please complete your resident profile before joining a queue.');
    }

    return resident;
};

const refreshCurrentServing = async (eventId, event) => {
    const serving = await HealthQueue.findOne({ eventId, status: 'serving' }).sort({ queueNumber: 1 });
    event.currentServing = serving?.queueNumber || 0;
    await event.save();
};

const ensureQueueEmail = async (entry) => {
    if (entry.email) return entry.email;
    if (!entry.userId) return '';

    const user = await User.findById(entry.userId).select('email');
    const email = String(user?.email || '').trim().toLowerCase();
    if (!email) return '';

    entry.email = email;
    await entry.save();
    return email;
};

const notifyQueueTurn = async (entry, eventId) => {
    const message = `Brgy Irawan: Hi ${entry.firstName}, it's your turn now. Please proceed to the Health Center. (${entry.queueCode})`;
    const email = await ensureQueueEmail(entry);
    const emailResult = email
        ? await mailer.sendCustomResidentEmail(
            email,
            `${entry.firstName} ${entry.lastName}`,
            'Health Center - Your Turn',
            message
        )
        : { sent: false, skipped: true, reason: 'missing_email' };
    const smsResult = entry.contactNumber
        ? await sendSmsNotification({
            phoneNumber: entry.contactNumber,
            messageType: 'health_queue',
            messageContent: message,
            recipientId: entry.residentId,
            referenceId: String(eventId || '')
        })
        : { sent: false, skipped: true, reason: 'missing_phone' };

    entry.notifiedTurn = Boolean(emailResult?.sent || smsResult?.sent);
    await entry.save();
    return { email: emailResult, sms: smsResult };
};

const notifyNextInLine = async (eventId) => {
    const entry = await HealthQueue.findOne({
        eventId,
        status: 'waiting',
        notifiedApproaching: false
    }).sort({ queueNumber: 1 });
    if (!entry) return null;

    const message = `Brgy Irawan: Hi ${entry.firstName}, you are next in line. Please be ready to proceed to the Health Center. (${entry.queueCode})`;
    const email = await ensureQueueEmail(entry);
    const emailResult = email
        ? await mailer.sendCustomResidentEmail(
            email,
            `${entry.firstName} ${entry.lastName}`,
            'Health Center - You Are Next',
            message
        )
        : { sent: false, skipped: true, reason: 'missing_email' };
    const smsResult = entry.contactNumber
        ? await sendSmsNotification({
            phoneNumber: entry.contactNumber,
            messageType: 'health_queue',
            messageContent: message,
            recipientId: entry.residentId,
            referenceId: String(eventId || '')
        })
        : { sent: false, skipped: true, reason: 'missing_phone' };

    entry.notifiedApproaching = Boolean(emailResult?.sent || smsResult?.sent);
    await entry.save();
    return { entry, email: emailResult, sms: smsResult };
};

const sendQueueJoinConfirmation = async (entry, event) => {
    const waitingAhead = await HealthQueue.countDocuments({
        eventId: event._id,
        status: 'waiting',
        queueNumber: { $lt: entry.queueNumber }
    });
    const positionText = waitingAhead === 0
        ? 'You are next in line.'
        : `There ${waitingAhead === 1 ? 'is' : 'are'} ${waitingAhead} waiting ${waitingAhead === 1 ? 'person' : 'people'} ahead of you.`;
    const message = `Brgy Irawan: You joined the ${event.title} queue. Your number is ${entry.queueCode}. ${positionText}`;

    const email = await ensureQueueEmail(entry);
    const emailResult = email
        ? await mailer.sendCustomResidentEmail(
            email,
            `${entry.firstName} ${entry.lastName}`,
            'Health Center - Queue Confirmation',
            message
        )
        : { sent: false, skipped: true, reason: 'missing_email' };
    const smsResult = entry.contactNumber
        ? await sendSmsNotification({
            phoneNumber: entry.contactNumber,
            messageType: 'health_queue',
            messageContent: message,
            recipientId: entry.residentId,
            referenceId: String(event._id || '')
        })
        : { sent: false, skipped: true, reason: 'missing_phone' };

    return { email: emailResult, sms: smsResult, waitingAhead };
};

const reserveQueueNumber = async (event, payload, attempts = 3) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const last = await HealthQueue.findOne({ eventId: event._id }).sort({ queueNumber: -1 });
        const nextNumber = last ? (last.queueNumber + 1) : 1;
        const entry = new HealthQueue({
            ...payload,
            queueNumber: nextNumber,
            queueCode: `${event.prefix}-${pad(nextNumber)}`
        });

        try {
            await entry.save();
            return entry;
        } catch (err) {
            if (err?.code !== 11000 || attempt === attempts - 1) {
                throw err;
            }
        }
    }

    throw createHttpError(409, 'Unable to reserve queue number. Please try again.');
};

const joinQueue = asyncHandler(async (req, res) => {
    const { eventId } = req.params;
    const resident = await getResidentForRequest(req);
    const contactNumber = String(resident.contactNumber || '').trim();

    const event = await HealthEvent.findById(eventId);
    if (!event) throw createHttpError(404, 'Event not found');
    if (!event.isQueueOpen) throw createHttpError(400, 'Queue is not open for this event');
    if (!contactNumber) {
        throw createHttpError(400, 'Please add a contact number to your resident profile before joining a queue.');
    }

    const existing = await HealthQueue.findOne({
        eventId,
        residentId: resident._id
    }).sort({ queueNumber: 1 });
    if (existing) {
        res.status(200).json({
            success: true,
            duplicate: true,
            message: `You already joined this event. Your number is ${existing.queueCode}.`,
            data: toQueueItem(existing, { residentId: resident._id })
        });
        return;
    }

    const entry = await reserveQueueNumber(event, {
        eventId,
        requesterType: 'resident',
        residentId: resident._id,
        userId: getUserId(req),
        firstName: String(resident.firstName || '').trim(),
        lastName: String(resident.lastName || '').trim(),
        contactNumber,
        email: resident.email || req.user?.email || '',
        status: 'waiting'
    });
    const notification = await sendQueueJoinConfirmation(entry, event);

    res.status(201).json({
        success: true,
        duplicate: false,
        message: `Joined queue. Your number is ${entry.queueCode}.`,
        data: toQueueItem(entry, { residentId: resident._id }),
        notification: {
            ...deliveryStatus(notification.email),
            waitingAhead: notification.waitingAhead
        }
    });
});

const listQueue = asyncHandler(async (req, res) => {
    const { eventId } = req.params;
    let residentId = null;
    if (!isQueueStaff(req) && req.user?.role === 'resident') {
        const resident = await Resident.findOne({ userId: getUserId(req) });
        residentId = resident?._id || null;
    }

    const viewer = { staff: isQueueStaff(req), residentId };
    const { event, items, summary } = await getQueueWithSummary(eventId, viewer);
    res.json({ success: true, data: items.map((item) => toQueueItem(item, viewer)), event, summary });
});

const getSummary = asyncHandler(async (req, res) => {
    const { eventId } = req.params;
    const { event, summary } = await getQueueWithSummary(eventId, { staff: true });
    res.json({ success: true, data: summary, event });
});

const callNext = asyncHandler(async (req, res) => {
    const { eventId } = req.params;

    const event = await HealthEvent.findOneAndUpdate(
        { _id: eventId, queueLock: { $ne: true } },
        { queueLock: true },
        { returnDocument: 'after' }
    );
    if (!event) throw createHttpError(409, 'Queue is busy. Please try again.');

    try {
        if (!event.isQueueOpen) {
            throw createHttpError(400, 'Queue is not open for this event');
        }

        await HealthQueue.updateMany(
            { eventId, status: 'serving' },
            { status: 'completed', completedAt: new Date() }
        );

        const current = await HealthQueue.findOneAndUpdate(
            { eventId, status: 'waiting' },
            { status: 'serving', servedAt: new Date() },
            { returnDocument: 'after', sort: { queueNumber: 1 } }
        );

        if (!current) {
            event.currentServing = 0;
            await event.save();
            const { summary } = await getQueueWithSummary(eventId, { staff: true });
            res.json({ success: true, message: 'No waiting queue entries', data: { current: null, event, summary } });
            return;
        }

        event.currentServing = current.queueNumber;
        await event.save();

        const turnNotification = await notifyQueueTurn(current, eventId);

        const nextNotification = await notifyNextInLine(eventId);

        const { summary } = await getQueueWithSummary(eventId, { staff: true });
        res.json({
            success: true,
            message: 'Called next',
            data: { current: toQueueItem(current, { staff: true }), event, summary },
            notification: {
                turnSent: Boolean(current.notifiedTurn),
                nextSent: Boolean(nextNotification?.entry?.notifiedApproaching),
                turn: deliveryStatus(turnNotification.email),
                next: nextNotification
                    ? deliveryStatus(nextNotification.email)
                    : null
            }
        });
    } finally {
        event.queueLock = false;
        await event.save();
    }
});

const updateStatus = asyncHandler(async (req, res) => {
    const { eventId, queueId } = req.params;
    const { status } = req.body;

    if (!STATUS_TRANSITIONS.has(status)) {
        throw createHttpError(400, 'Invalid queue status');
    }

    const event = await HealthEvent.findById(eventId);
    if (!event) throw createHttpError(404, 'Event not found');

    const existing = await HealthQueue.findOne({ _id: queueId, eventId });
    if (!existing) throw createHttpError(404, 'Queue entry not found');
    if (existing.status === status) {
        const { summary } = await getQueueWithSummary(eventId, { staff: true });
        res.json({ success: true, message: 'Queue status unchanged', data: toQueueItem(existing, { staff: true }), summary });
        return;
    }
    if (!ALLOWED_STATUS_TRANSITIONS[existing.status]?.has(status)) {
        throw createHttpError(400, `Cannot change queue status from ${existing.status} to ${status}`);
    }

    const update = { status };
    if (status === 'serving') update.servedAt = new Date();
    if (TERMINAL_QUEUE_STATUSES.includes(status)) update.completedAt = new Date();

    const item = await HealthQueue.findOneAndUpdate(
        { _id: queueId, eventId },
        update,
        { returnDocument: 'after' }
    );
    if (!item) throw createHttpError(404, 'Queue entry not found');

    let turnNotification = null;
    let nextNotification = null;
    if (status === 'serving') {
        await HealthQueue.updateMany(
            { eventId, _id: { $ne: item._id }, status: 'serving' },
            { status: 'completed', completedAt: new Date() }
        );
        event.currentServing = item.queueNumber;
        await event.save();
        turnNotification = await notifyQueueTurn(item, eventId);
        nextNotification = await notifyNextInLine(eventId);
    } else if (existing.status === 'serving' && TERMINAL_QUEUE_STATUSES.includes(status)) {
        await refreshCurrentServing(eventId, event);
    }

    const { summary } = await getQueueWithSummary(eventId, { staff: true });
    res.json({
        success: true,
        message: 'Queue status updated',
        data: toQueueItem(item, { staff: true }),
        summary,
        notification: status === 'serving'
            ? {
                turnSent: Boolean(turnNotification?.email?.sent),
                nextSent: Boolean(nextNotification?.entry?.notifiedApproaching),
                turn: deliveryStatus(turnNotification?.email),
                next: nextNotification
                    ? deliveryStatus(nextNotification.email)
                    : null
            }
            : undefined
    });
});

const updateQueueDetails = asyncHandler(async (req, res) => {
    const { eventId, queueId } = req.params;
    const item = await HealthQueue.findOne({ _id: queueId, eventId });
    if (!item) throw createHttpError(404, 'Queue entry not found');
    if (item.status !== 'waiting') {
        throw createHttpError(400, 'Only waiting queue entries can be edited');
    }

    const firstName = String(req.body.firstName || '').trim();
    const lastName = String(req.body.lastName || '').trim();
    const contactNumber = String(req.body.contactNumber || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!firstName || !lastName || !contactNumber) {
        throw createHttpError(400, 'First name, last name, and contact number are required');
    }
    if (email && !EMAIL_RE.test(email)) {
        throw createHttpError(400, 'Please provide a valid email address');
    }

    item.firstName = firstName;
    item.lastName = lastName;
    item.contactNumber = contactNumber;
    item.email = email;
    item.notifiedApproaching = false;
    item.notifiedTurn = false;
    await item.save();

    res.json({ success: true, message: 'Queue entry updated', data: toQueueItem(item, { staff: true }) });
});

const deleteQueueEntry = asyncHandler(async (req, res) => {
    const { eventId, queueId } = req.params;
    const item = await HealthQueue.findOne({ _id: queueId, eventId });
    if (!item) throw createHttpError(404, 'Queue entry not found');
    if (!TERMINAL_QUEUE_STATUSES.includes(item.status)) {
        throw createHttpError(400, 'Complete, cancel, or mark the entry as no-show before deleting it');
    }

    await HealthQueue.deleteOne({ _id: queueId, eventId });
    res.json({ success: true, message: 'Queue entry deleted' });
});

module.exports = {
    joinQueue,
    listQueue,
    getSummary,
    callNext,
    updateStatus,
    updateQueueDetails,
    deleteQueueEntry
};
