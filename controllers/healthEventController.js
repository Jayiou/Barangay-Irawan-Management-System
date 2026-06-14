const HealthEvent = require('../models/HealthEvent');
const HealthQueue = require('../models/HealthQueue');
const asyncHandler = require('../utils/asyncHandler');
const { createHttpError } = require('../utils/httpError');

const EVENT_STATUSES = new Set(['upcoming', 'ongoing', 'completed', 'cancelled']);
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const normalizePrefix = (prefix) => String(prefix || '').trim().toUpperCase();

const parseEventDate = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw createHttpError(400, 'Please provide a valid event date');
    }
    return date;
};

const validateTimeRange = (startTime, endTime) => {
    if (!TIME_RE.test(String(startTime || '')) || !TIME_RE.test(String(endTime || ''))) {
        throw createHttpError(400, 'Please provide valid start and end times');
    }
    if (startTime >= endTime) {
        throw createHttpError(400, 'End time must be later than start time');
    }
};

const createEvent = asyncHandler(async (req, res) => {
    const { title, description, prefix, eventDate, startTime, endTime } = req.body;

    if (!title || !prefix || !eventDate || !startTime || !endTime) {
        throw createHttpError(400, 'title, prefix, eventDate, startTime and endTime are required');
    }
    validateTimeRange(startTime, endTime);
    const normalizedPrefix = normalizePrefix(prefix);
    if (!normalizedPrefix || normalizedPrefix.length > 5) {
        throw createHttpError(400, 'Prefix must be 1 to 5 characters');
    }

    const event = new HealthEvent({
        title: String(title).trim(),
        description: description || '',
        prefix: normalizedPrefix,
        eventDate: parseEventDate(eventDate),
        startTime,
        endTime,
        createdBy: req.user?._id
    });

    await event.save();

    res.status(201).json({ success: true, message: 'Health event created', data: event });
});

const listEvents = asyncHandler(async (req, res) => {
    const { status } = req.query;
    const query = {};
    if (status) query.status = status;

    const events = await HealthEvent.find(query).sort({ eventDate: -1 });
    res.json({ success: true, data: events });
});

const getEvent = asyncHandler(async (req, res) => {
    const event = await HealthEvent.findById(req.params.id);
    if (!event) throw createHttpError(404, 'Event not found');
    res.json({ success: true, data: event });
});

const updateEvent = asyncHandler(async (req, res) => {
    const event = await HealthEvent.findById(req.params.id);
    if (!event) throw createHttpError(404, 'Event not found');

    const { title, description, prefix, eventDate, startTime, endTime, status } = req.body;
    const nextStartTime = startTime || event.startTime;
    const nextEndTime = endTime || event.endTime;
    validateTimeRange(nextStartTime, nextEndTime);

    if (title) event.title = String(title).trim();
    if (description !== undefined) event.description = description;
    if (prefix) {
        const normalizedPrefix = normalizePrefix(prefix);
        if (!normalizedPrefix || normalizedPrefix.length > 5) {
            throw createHttpError(400, 'Prefix must be 1 to 5 characters');
        }
        event.prefix = normalizedPrefix;
    }
    if (eventDate) event.eventDate = parseEventDate(eventDate);
    if (startTime) event.startTime = startTime;
    if (endTime) event.endTime = endTime;
    if (status) {
        if (!EVENT_STATUSES.has(status)) throw createHttpError(400, 'Invalid event status');
        event.status = status;
    }

    event.updatedAt = new Date();
    await event.save();

    res.json({ success: true, message: 'Event updated', data: event });
});

const toggleQueue = asyncHandler(async (req, res) => {
    const event = await HealthEvent.findById(req.params.id);
    if (!event) throw createHttpError(404, 'Event not found');

    const { open } = req.body; // boolean
    event.isQueueOpen = Boolean(open);
    if (event.isQueueOpen) event.status = 'ongoing';
    await event.save();

    res.json({ success: true, message: `Queue ${event.isQueueOpen ? 'opened' : 'closed'}`, data: event });
});

const deleteEvent = asyncHandler(async (req, res) => {
    const event = await HealthEvent.findById(req.params.id);
    if (!event) throw createHttpError(404, 'Event not found');

    const queueRecordCount = await HealthQueue.countDocuments({ eventId: event._id });
    if (queueRecordCount > 0) {
        throw createHttpError(409, 'This event already has queue records and cannot be deleted. Mark it as cancelled to preserve its history.');
    }

    await event.deleteOne();
    res.json({ success: true, message: 'Health event deleted' });
});

module.exports = {
    createEvent,
    listEvents,
    getEvent,
    updateEvent,
    toggleQueue,
    deleteEvent
};
