const ManpowerRequest = require('../models/ManpowerRequest');
const Resident = require('../models/Resident');
const asyncHandler = require('../utils/asyncHandler');
const { createHttpError } = require('../utils/httpError');
const { isValidTransition } = require('../utils/statusWorkflows');
const { logStatusChange } = require('../utils/statusLogger');
const { sendRequestStatusEmail } = require('../utils/mailer');
const { sendRequestStatusSMS } = require('../utils/sms');

const requestFields = [
    'assistanceType',
    'title',
    'description',
    'requestLocation',
    'requestDate',
    'requestTime',
    'estimatedDuration',
    'requestedPersonnelCount',
    'priority'
];

const requesterFields = ['firstName', 'middleName', 'lastName', 'suffix', 'contactNumber', 'email', 'address'];
const statusFields = ['status', 'adminNotes', 'completionNotes', 'assignedOfficers'];

const pickFields = (source, fields) => fields.reduce((accumulator, field) => {
    if (source[field] !== undefined) {
        accumulator[field] = source[field];
    }

    return accumulator;
}, {});

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const isValidDate = (value) => !Number.isNaN(new Date(value).getTime());
const normalizeText = (value) => String(value || '').trim();

const buildResidentRequestPayload = (residentId, requestData) => ({
    residentId,
    requesterType: 'resident',
    firstName: '',
    middleName: '',
    lastName: '',
    suffix: '',
    contactNumber: '',
    email: '',
    address: '',
    ...requestData
});

const buildGuestRequestPayload = (requestData) => ({
    ...requestData,
    residentId: null,
    requesterType: 'guest',
    firstName: normalizeText(requestData.firstName),
    middleName: normalizeText(requestData.middleName),
    lastName: normalizeText(requestData.lastName),
    suffix: normalizeText(requestData.suffix),
    contactNumber: normalizeText(requestData.contactNumber),
    email: normalizeText(requestData.email).toLowerCase(),
    address: normalizeText(requestData.address)
});

const getRequesterName = (request) => {
    const guestName = [request.firstName, request.middleName, request.lastName, request.suffix].filter(Boolean).join(' ').trim();

    if (guestName) {
        return guestName;
    }

    if (request.residentId) {
        return [request.residentId.firstName, request.residentId.middleName, request.residentId.lastName, request.residentId.suffix].filter(Boolean).join(' ').trim();
    }

    return 'Guest Requester';
};

const formatEmailDate = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
};

const formatLabel = (value) => normalizeText(value).replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase());

const buildRequestEmailDetails = (request, status) => [
    { label: 'Request Type', value: 'Manpower Assistance' },
    { label: 'Title', value: request.title },
    { label: 'Assistance Type', value: formatLabel(request.assistanceType) },
    { label: 'Location', value: request.requestLocation },
    { label: 'Request Date', value: formatEmailDate(request.requestDate) },
    { label: 'Request Time', value: request.requestTime },
    { label: 'Priority', value: formatLabel(request.priority) },
    { label: 'Status', value: formatLabel(status) }
];

const validateRequestData = (payload) => {
    if (payload.requestedPersonnelCount !== undefined) {
        const count = Number(payload.requestedPersonnelCount);
        if (!Number.isInteger(count) || count < 1) {
            return 'Please provide a valid requestedPersonnelCount';
        }
        payload.requestedPersonnelCount = count;
    }

    if (payload.assistanceType !== undefined && !hasText(payload.assistanceType)) {
        return 'Please provide a valid assistanceType';
    }

    if (payload.title !== undefined && !hasText(payload.title)) {
        return 'Please provide a valid title';
    }

    if (payload.description !== undefined && !hasText(payload.description)) {
        return 'Please provide a valid description';
    }

    if (payload.requestLocation !== undefined && !hasText(payload.requestLocation)) {
        return 'Please provide a valid requestLocation';
    }

    if (payload.requestDate !== undefined && !isValidDate(payload.requestDate)) {
        return 'Please provide a valid requestDate';
    }

    return null;
};

const validateGuestRequestData = (payload) => {
    const required = ['firstName', 'lastName', 'contactNumber', 'email', 'address'];

    if (required.some((field) => !hasText(payload[field]))) {
        return 'firstName, lastName, contactNumber, email, and address are required';
    }

    return null;
};

const populateRequest = (query) => query.populate({
    path: 'residentId',
    select: 'firstName middleName lastName contactNumber email address purok userId',
    populate: {
        path: 'userId',
        select: 'username email role isActive'
    }
});

const buildStatusHistoryEntry = (previousStatus, newStatus, req, reason = '') => ({
    previousStatus,
    newStatus,
    reason: normalizeText(reason),
    changedBy: req.user?._id || req.user?.id || null,
    changedByName: req.user?.username || req.user?.email || 'System',
    createdAt: new Date()
});

exports.createRequest = asyncHandler(async (req, res) => {
    const requestData = pickFields(req.body, requestFields);
    const validationError = validateRequestData(requestData);

    if (!requestData.assistanceType || !requestData.title || !requestData.description || !requestData.requestLocation || !requestData.requestDate || requestData.requestedPersonnelCount === undefined) {
        throw createHttpError(400, 'assistanceType, title, description, requestLocation, requestDate, and requestedPersonnelCount are required', {
            code: 'MANPOWER_VALIDATION_ERROR'
        });
    }

    if (validationError) {
        throw createHttpError(400, validationError, { code: 'MANPOWER_VALIDATION_ERROR' });
    }

    const resident = await Resident.findOne({ userId: req.user.id });

    if (!resident) {
        throw createHttpError(404, 'Resident profile not found. Please complete your profile first.', {
            code: 'RESIDENT_NOT_FOUND'
        });
    }

    const request = await ManpowerRequest.create(buildResidentRequestPayload(resident._id, requestData));

    const populatedRequest = await populateRequest(ManpowerRequest.findById(request._id));
    res.status(201).json(populatedRequest);
});

exports.createPublicRequest = asyncHandler(async (req, res) => {
    const requestData = pickFields(req.body, [...requestFields, ...requesterFields]);
    const validationError = validateRequestData(requestData) || validateGuestRequestData(requestData);

    if (!requestData.assistanceType || !requestData.title || !requestData.description || !requestData.requestLocation || !requestData.requestDate || requestData.requestedPersonnelCount === undefined) {
        throw createHttpError(400, 'assistanceType, title, description, requestLocation, requestDate, and requestedPersonnelCount are required', {
            code: 'MANPOWER_VALIDATION_ERROR'
        });
    }

    if (validationError) {
        throw createHttpError(400, validationError, { code: 'MANPOWER_VALIDATION_ERROR' });
    }

    const request = await ManpowerRequest.create(buildGuestRequestPayload(requestData));
    const populatedRequest = await populateRequest(ManpowerRequest.findById(request._id));

    res.status(201).json(populatedRequest);
});

exports.getMyRequests = asyncHandler(async (req, res) => {
    const resident = await Resident.findOne({ userId: req.user.id });

    if (!resident) {
        throw createHttpError(404, 'Resident profile not found. Please complete your profile first.', {
            code: 'RESIDENT_NOT_FOUND'
        });
    }

    const requests = await populateRequest(
        ManpowerRequest.find({ residentId: resident._id }).sort({ createdAt: -1 })
    );

    res.json(requests);
});

exports.getRequests = asyncHandler(async (req, res) => {
    const requests = await populateRequest(
        ManpowerRequest.find().sort({ createdAt: -1 })
    );

    res.json(requests);
});

exports.getRequestById = asyncHandler(async (req, res) => {
    const request = await populateRequest(
        ManpowerRequest.findById(req.params.id)
    );

    if (!request) {
        throw createHttpError(404, 'Manpower request not found', { code: 'MANPOWER_NOT_FOUND' });
    }

    if (req.user.role === 'resident') {
        const resident = await Resident.findOne({ userId: req.user.id });

        if (!request.residentId || !resident || request.residentId._id.toString() !== resident._id.toString()) {
            throw createHttpError(403, 'Access denied', { code: 'MANPOWER_FORBIDDEN' });
        }
    }

    res.json(request);
});

exports.updateRequestStatus = asyncHandler(async (req, res) => {
    const statusData = pickFields(req.body, statusFields);

    if (!statusData.status) {
        throw createHttpError(400, 'status is required', { code: 'MANPOWER_VALIDATION_ERROR' });
    }

    const request = await ManpowerRequest.findById(req.params.id);

    if (!request) {
        throw createHttpError(404, 'Manpower request not found', { code: 'MANPOWER_NOT_FOUND' });
    }

    // Validate status transition
    if (!isValidTransition('manpowerRequest', request.status, statusData.status)) {
        throw createHttpError(400, `Cannot transition from ${request.status} to ${statusData.status}`, {
            code: 'INVALID_STATUS_TRANSITION'
        });
    }

    const previousStatus = request.status;

    const statusHistoryEntry = buildStatusHistoryEntry(previousStatus, statusData.status, req, statusData.adminNotes || '');

    const updatedRequest = await ManpowerRequest.findByIdAndUpdate(
        req.params.id,
        {
            $set: statusData,
            $push: { statusHistory: statusHistoryEntry }
        },
        { returnDocument: 'after', runValidators: true }
    );

    // Log the status change
    try {
        await logStatusChange(
            'ManpowerRequest',
            req.params.id,
            previousStatus,
            statusData.status,
            req.user,
            statusData.adminNotes || '',
            req.ip || req.connection?.remoteAddress || ''
        );
    } catch (logError) {
        console.error('Failed to log status change:', logError);
    }

    const populatedRequest = await populateRequest(
        ManpowerRequest.findById(updatedRequest._id)
    );

    const recipientEmail = populatedRequest.email || populatedRequest.residentId?.email;

    if (recipientEmail) {
        await sendRequestStatusEmail(
            recipientEmail,
            getRequesterName(populatedRequest),
            'manpower',
            statusData.status,
            statusData.adminNotes || '',
            buildRequestEmailDetails(populatedRequest, statusData.status)
        );
    }
    const recipientPhone = populatedRequest.contactNumber || populatedRequest.residentId?.contactNumber;
    if (recipientPhone) {
        await sendRequestStatusSMS(recipientPhone, getRequesterName(populatedRequest), 'manpower request', statusData.status, {
            messageType: 'manpower_status',
            recipientId: populatedRequest.residentId?._id,
            referenceId: String(populatedRequest._id || '')
        });
    }

    res.json(populatedRequest);
});

exports.cancelMyRequest = asyncHandler(async (req, res) => {
    const resident = await Resident.findOne({ userId: req.user.id });

    if (!resident) {
        throw createHttpError(404, 'Resident profile not found. Please complete your profile first.', {
            code: 'RESIDENT_NOT_FOUND'
        });
    }

    const request = await ManpowerRequest.findById(req.params.id);

    if (!request) {
        throw createHttpError(404, 'Manpower request not found', { code: 'MANPOWER_NOT_FOUND' });
    }

    if (!request.residentId || request.residentId.toString() !== resident._id.toString()) {
        throw createHttpError(403, 'Access denied', { code: 'MANPOWER_FORBIDDEN' });
    }

    if (!['pending', 'approved'].includes(request.status)) {
        throw createHttpError(400, `Cannot cancel manpower request with status: ${request.status}`, {
            code: 'INVALID_STATUS_TRANSITION'
        });
    }

    const previousStatus = request.status;
    request.status = 'cancelled';
    request.adminNotes = req.body?.cancellationReason || request.adminNotes || '';
    request.statusHistory = Array.isArray(request.statusHistory) ? request.statusHistory : [];
    request.statusHistory.push(buildStatusHistoryEntry(previousStatus, 'cancelled', req, req.body?.cancellationReason || 'Cancelled by resident'));
    await request.save();

    try {
        await logStatusChange(
            'ManpowerRequest',
            request._id,
            previousStatus,
            'cancelled',
            req.user,
            req.body?.cancellationReason || 'Cancelled by resident',
            req.ip || req.connection?.remoteAddress || ''
        );
    } catch (logError) {
        console.error('Failed to log status change:', logError);
    }

    const populatedRequest = await populateRequest(ManpowerRequest.findById(request._id));
    res.json(populatedRequest);
});

exports.deleteMyRequest = asyncHandler(async (req, res) => {
    const request = await ManpowerRequest.findById(req.params.id);

    if (!request) {
        throw createHttpError(404, 'Manpower request not found', { code: 'MANPOWER_NOT_FOUND' });
    }

    const allowedStatuses = req.user.role === 'admin' ? ['rejected', 'cancelled'] : ['completed', 'rejected', 'cancelled'];
    if (!allowedStatuses.includes(request.status)) {
        throw createHttpError(400, `Cannot delete manpower request with status: ${request.status}`, {
            code: 'MANPOWER_NOT_TERMINAL'
        });
    }

    if (req.user.role !== 'admin') {
        const resident = await Resident.findOne({ userId: req.user.id });

        if (!resident) {
            throw createHttpError(404, 'Resident profile not found. Please complete your profile first.', {
                code: 'RESIDENT_NOT_FOUND'
            });
        }

        if (!request.residentId || request.residentId.toString() !== resident._id.toString()) {
            throw createHttpError(403, 'Access denied', { code: 'MANPOWER_FORBIDDEN' });
        }
    }

    await ManpowerRequest.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Manpower request deleted successfully' });
});
