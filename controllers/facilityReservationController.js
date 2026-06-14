const FacilityReservation = require('../models/FacilityReservation');
const Resident = require('../models/Resident');
const asyncHandler = require('../utils/asyncHandler');
const { createHttpError } = require('../utils/httpError');
const { isValidTransition } = require('../utils/statusWorkflows');
const { logStatusChange } = require('../utils/statusLogger');
const { sendRequestStatusEmail } = require('../utils/mailer');
const { sendRequestStatusSMS } = require('../utils/sms');

const reservationFields = [
    'facilityName',
    'reservationDate',
    'startTime',
    'endTime',
    'quantity',
    'purpose',
    'reservationDetails',
    'chairQuantity',
    'tentQuantity',
    'tableQuantity'
];

const reservationRequesterFields = ['firstName', 'middleName', 'lastName', 'suffix', 'contactNumber', 'email', 'address'];
const reservationStatusFields = ['status', 'adminNotes'];
const OPERATING_HOURS = {
    start: '08:00',
    end: '24:00'
};
const SLOT_DURATION_MINUTES = 30;
const CONFLICT_STATUSES = ['pending', 'approved', 'rescheduled'];
const FACILITY_INVENTORY = {
    chair: 300,
    tent: 30,
    table: 20
};
const INVENTORY_FACILITY_NAMES = Object.keys(FACILITY_INVENTORY);
const INVENTORY_LABELS = {
    chair: 'chairs',
    tent: 'tents',
    table: 'tables'
};

const pickFields = (source, fields) => fields.reduce((accumulator, field) => {
    if (source[field] !== undefined) {
        accumulator[field] = source[field];
    }

    return accumulator;
}, {});

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const isValidDate = (value) => !Number.isNaN(new Date(value).getTime());
const timePattern = /^(?:([01]\d|2[0-3]):([0-5]\d)|24:00)$/;
const normalizeText = (value) => String(value || '').trim();
const normalizeEmail = (value) => normalizeText(value).toLowerCase();

const isValidTime = (value) => hasText(value) && timePattern.test(value.trim());

const toMinutes = (value) => {
    const normalized = String(value || '').trim();

    if (normalized === '24:00') {
        return 24 * 60;
    }

    const [hours, minutes] = normalized.split(':').map(Number);
    return (hours * 60) + minutes;
};

const formatYMD = (date) => (
    date.getFullYear()
    + '-'
    + String(date.getMonth() + 1).padStart(2, '0')
    + '-'
    + String(date.getDate()).padStart(2, '0')
);

const isValidReservationDate = (reservationDate, minDaysAhead = 1) => {
    if (!isValidDate(reservationDate)) {
        return false;
    }

    const selectedDate = new Date(`${formatYMD(new Date(reservationDate))}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const minDate = new Date(today);
    minDate.setDate(minDate.getDate() + minDaysAhead);

    return selectedDate >= minDate;
};

const toReservationQuantity = (value) => {
    if (value === undefined || value === null || value === '') {
        return 0;
    }

    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed < 0) {
        return null;
    }

    return parsed;
};

const getReservationQuantity = (reservation) => {
    const quantity = Number(reservation.quantity);
    if (Number.isFinite(quantity) && quantity > 0) {
        return quantity;
    }

    const chairQuantity = Number(reservation.chairQuantity);
    const tentQuantity = Number(reservation.tentQuantity);
    const tableQuantity = Number(reservation.tableQuantity);

    if (Number.isFinite(chairQuantity) || Number.isFinite(tentQuantity) || Number.isFinite(tableQuantity)) {
        return (Number.isFinite(chairQuantity) ? chairQuantity : 0) + (Number.isFinite(tentQuantity) ? tentQuantity : 0) + (Number.isFinite(tableQuantity) ? tableQuantity : 0);
    }

    return 0;
};

const getFacilityInventoryCapacity = (facilityName) => FACILITY_INVENTORY[facilityName] || null;

const isInventoryFacility = (facilityName) => INVENTORY_FACILITY_NAMES.includes(String(facilityName || '').trim());

const buildInventoryTotals = (reservations = []) => reservations.reduce((totals, reservation) => {
    const quantity = getReservationQuantity(reservation);
    if (reservation.facilityName === 'chair') {
        totals.chair += quantity;
    } else if (reservation.facilityName === 'tent') {
        totals.tent += quantity;
    } else if (reservation.facilityName === 'table') {
        totals.table += quantity;
    }
    return totals;
}, { chair: 0, tent: 0, table: 0 });

const getPeakReservedQuantityForRange = (reservations = [], startTime = OPERATING_HOURS.start, endTime = OPERATING_HOURS.end) => {
    const rangeStart = toMinutes(startTime);
    const rangeEnd = toMinutes(endTime);
    const boundaries = new Set([rangeStart, rangeEnd]);
    const overlappingReservations = reservations.filter((reservation) => {
        const reservationStart = toMinutes(reservation.startTime);
        const reservationEnd = toMinutes(reservation.endTime);

        if (!rangesOverlap(rangeStart, rangeEnd, reservationStart, reservationEnd)) {
            return false;
        }

        boundaries.add(Math.max(rangeStart, reservationStart));
        boundaries.add(Math.min(rangeEnd, reservationEnd));
        return true;
    });

    const sortedBoundaries = Array.from(boundaries).sort((a, b) => a - b);

    return sortedBoundaries.reduce((peak, currentStart, index) => {
        const currentEnd = sortedBoundaries[index + 1];
        if (currentEnd === undefined || currentStart >= currentEnd) {
            return peak;
        }

        const reservedQuantity = overlappingReservations.reduce((total, reservation) => {
            const reservationStart = toMinutes(reservation.startTime);
            const reservationEnd = toMinutes(reservation.endTime);

            return rangesOverlap(currentStart, currentEnd, reservationStart, reservationEnd)
                ? total + getReservationQuantity(reservation)
                : total;
        }, 0);

        return Math.max(peak, reservedQuantity);
    }, 0);
};

const buildInventoryPeakTotals = (reservations = []) => INVENTORY_FACILITY_NAMES.reduce((totals, facilityName) => {
    const facilityReservations = reservations.filter((reservation) => reservation.facilityName === facilityName);
    totals[facilityName] = getPeakReservedQuantityForRange(facilityReservations);
    return totals;
}, { chair: 0, tent: 0, table: 0 });

const buildInventoryAvailability = (reservations = []) => {
    const reservedQuantities = buildInventoryPeakTotals(reservations);

    return {
        inventory: FACILITY_INVENTORY,
        reservedQuantities,
        availableQuantities: {
            chair: Math.max(FACILITY_INVENTORY.chair - reservedQuantities.chair, 0),
            tent: Math.max(FACILITY_INVENTORY.tent - reservedQuantities.tent, 0),
            table: Math.max(FACILITY_INVENTORY.table - reservedQuantities.table, 0)
        }
    };
};

const validateReservationInventory = (payload) => {
    if (!isInventoryFacility(payload.facilityName)) {
        return null;
    }

    const quantity = toReservationQuantity(payload.quantity ?? payload.chairQuantity ?? payload.tentQuantity ?? payload.tableQuantity);

    if (quantity === null) {
        return 'quantity must be a whole number greater than or equal to 0';
    }

    const capacity = getFacilityInventoryCapacity(payload.facilityName);
    if (!capacity) {
        return null;
    }

    if (quantity <= 0) {
        return 'Please reserve at least 1 item';
    }

    if (quantity > capacity) {
        return `quantity cannot exceed ${capacity}`;
    }

    return null;
};

const sameDayRange = (value) => {
    const day = new Date(value);
    day.setHours(0, 0, 0, 0);

    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);

    return { day, nextDay };
};

const rangesOverlap = (startA, endA, startB, endB) => startA < endB && startB < endA;

const validateTimeWindow = (startTime, endTime) => {
    if (startTime !== undefined && !isValidTime(startTime)) {
        return 'Please provide a valid startTime in HH:MM format';
    }

    if (endTime !== undefined && !isValidTime(endTime)) {
        return 'Please provide a valid endTime in HH:MM format';
    }

    if (startTime !== undefined && endTime !== undefined && toMinutes(startTime) >= toMinutes(endTime)) {
        return 'endTime must be later than startTime';
    }

    if (
        startTime !== undefined
        && endTime !== undefined
        && (
            toMinutes(startTime) < toMinutes(OPERATING_HOURS.start)
            || toMinutes(endTime) > toMinutes(OPERATING_HOURS.end)
        )
    ) {
        return `Reservations must be within operating hours ${OPERATING_HOURS.start}-${OPERATING_HOURS.end}`;
    }

    return null;
};

const populateReservation = (query) => query.populate({
    path: 'residentId',
    select: 'firstName middleName lastName contactNumber email address purok userId',
    populate: {
        path: 'userId',
        select: 'username email role isActive'
    }
});

const buildResidentReservationPayload = (residentId, reservationData) => ({
    residentId,
    requesterType: 'resident',
    firstName: '',
    middleName: '',
    lastName: '',
    suffix: '',
    contactNumber: '',
    email: '',
    address: '',
    ...reservationData,
    quantity: toReservationQuantity(reservationData.quantity ?? reservationData.chairQuantity ?? reservationData.tentQuantity ?? reservationData.tableQuantity) || 0
});

const buildGuestReservationPayload = (reservationData) => ({
    ...reservationData,
    residentId: null,
    requesterType: 'guest',
    firstName: normalizeText(reservationData.firstName),
    middleName: normalizeText(reservationData.middleName),
    lastName: normalizeText(reservationData.lastName),
    suffix: normalizeText(reservationData.suffix),
    contactNumber: normalizeText(reservationData.contactNumber),
    email: normalizeText(reservationData.email).toLowerCase(),
    address: normalizeText(reservationData.address),
    quantity: toReservationQuantity(reservationData.quantity ?? reservationData.chairQuantity ?? reservationData.tentQuantity ?? reservationData.tableQuantity) || 0
});

const getReservationRequesterName = (reservation) => {
    const guestName = [reservation.firstName, reservation.middleName, reservation.lastName, reservation.suffix].filter(Boolean).join(' ').trim();

    if (guestName) {
        return guestName;
    }

    if (reservation.residentId) {
        return [reservation.residentId.firstName, reservation.residentId.middleName, reservation.residentId.lastName, reservation.residentId.suffix].filter(Boolean).join(' ').trim();
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

const buildReservationEmailDetails = (reservation, status) => [
    { label: 'Request Type', value: 'Facility Reservation' },
    { label: 'Facility', value: formatLabel(reservation.facilityName) },
    { label: 'Reservation Date', value: formatEmailDate(reservation.reservationDate) },
    { label: 'Time Slot', value: reservation.startTime && reservation.endTime ? `${reservation.startTime}-${reservation.endTime}` : '' },
    { label: 'Quantity', value: getReservationQuantity(reservation) || '' },
    { label: 'Purpose', value: reservation.purpose },
    { label: 'Status', value: formatLabel(status) }
];

const validateReservationData = (payload) => {
    if (payload.reservationDate !== undefined && !isValidDate(payload.reservationDate)) {
        return 'Please provide a valid reservationDate';
    }

    if (payload.reservationDate !== undefined && !isValidReservationDate(payload.reservationDate)) {
        return 'Reservations must be scheduled at least 1 day in advance';
    }

    if (payload.startTime !== undefined && !hasText(payload.startTime)) {
        return 'Please provide a valid startTime';
    }

    if (payload.endTime !== undefined && !hasText(payload.endTime)) {
        return 'Please provide a valid endTime';
    }

    if (payload.purpose !== undefined && !hasText(payload.purpose)) {
        return 'Please provide a valid purpose';
    }

    const timeWindowError = validateTimeWindow(payload.startTime, payload.endTime);

    if (timeWindowError) {
        return timeWindowError;
    }

    const inventoryError = validateReservationInventory(payload);

    if (inventoryError) {
        return inventoryError;
    }

    return null;
};

const validateGuestReservationData = (payload) => {
    const required = ['firstName', 'lastName', 'contactNumber', 'email', 'address'];

    if (required.some((field) => !hasText(payload[field]))) {
        return 'firstName, lastName, contactNumber, email, and address are required';
    }

    return null;
};

const findConflictingReservation = async ({
    facilityName,
    reservationDate,
    startTime,
    endTime,
    excludeReservationId
}) => {
    const { day, nextDay } = sameDayRange(reservationDate);
    const reservations = await FacilityReservation.find({
        facilityName,
        reservationDate: {
            $gte: day,
            $lt: nextDay
        },
        status: { $in: CONFLICT_STATUSES }
    });

    const requestedStart = toMinutes(startTime);
    const requestedEnd = toMinutes(endTime);

    return reservations.find((reservation) => {
        if (reservation._id?.toString() === excludeReservationId?.toString()) {
            return false;
        }

        return rangesOverlap(
            requestedStart,
            requestedEnd,
            toMinutes(reservation.startTime),
            toMinutes(reservation.endTime)
        );
    }) || null;
};

const findOverlappingInventoryReservations = async ({
    facilityName,
    reservationDate,
    startTime,
    endTime,
    excludeReservationId
}) => {
    const { day, nextDay } = sameDayRange(reservationDate);
    const reservations = await FacilityReservation.find({
        facilityName,
        reservationDate: {
            $gte: day,
            $lt: nextDay
        },
        status: { $in: CONFLICT_STATUSES }
    });

    const requestedStart = toMinutes(startTime);
    const requestedEnd = toMinutes(endTime);

    return reservations.filter((reservation) => {
        if (reservation._id?.toString() === excludeReservationId?.toString()) {
            return false;
        }

        return rangesOverlap(
            requestedStart,
            requestedEnd,
            toMinutes(reservation.startTime),
            toMinutes(reservation.endTime)
        );
    });
};

const validateInventoryAvailability = async ({
    facilityName,
    reservationDate,
    startTime,
    endTime,
    quantity,
    chairQuantity,
    tentQuantity,
    tableQuantity,
    excludeReservationId
}) => {
    if (!isInventoryFacility(facilityName)) {
        return null;
    }

    const capacity = getFacilityInventoryCapacity(facilityName);
    const requestedQuantity = toReservationQuantity(quantity ?? chairQuantity ?? tentQuantity ?? tableQuantity);

    if (!capacity) {
        return null;
    }

    if (requestedQuantity === null || requestedQuantity <= 0) {
        return 'Please reserve at least 1 item';
    }

    const overlappingReservations = await findOverlappingInventoryReservations({
        facilityName,
        reservationDate,
        startTime,
        endTime,
        excludeReservationId
    });

    const reservedQuantity = getPeakReservedQuantityForRange(overlappingReservations, startTime, endTime);

    if ((reservedQuantity + requestedQuantity) > capacity) {
        const availableQuantity = Math.max(capacity - reservedQuantity, 0);
        return `Only ${availableQuantity} ${INVENTORY_LABELS[facilityName] || 'items'} are available for the selected time.`;
    }

    return null;
};

const buildAvailableSlots = (reservations, isInventoryView = false) => {
    if (isInventoryView) {
        const slots = [];

        for (
            let current = toMinutes(OPERATING_HOURS.start);
            current + SLOT_DURATION_MINUTES <= toMinutes(OPERATING_HOURS.end);
            current += SLOT_DURATION_MINUTES
        ) {
            const slotStart = current;
            const slotEnd = current + SLOT_DURATION_MINUTES;

            const startHours = String(Math.floor(slotStart / 60)).padStart(2, '0');
            const startMinutes = String(slotStart % 60).padStart(2, '0');
            const endHours = String(Math.floor(slotEnd / 60)).padStart(2, '0');
            const endMinutes = String(slotEnd % 60).padStart(2, '0');

            slots.push({
                startTime: `${startHours}:${startMinutes}`,
                endTime: `${endHours}:${endMinutes}`
            });
        }

        return slots;
    }

    const slots = [];
    const reservedRanges = reservations.map((reservation) => ({
        start: toMinutes(reservation.startTime),
        end: toMinutes(reservation.endTime)
    }));

    for (
        let current = toMinutes(OPERATING_HOURS.start);
        current + SLOT_DURATION_MINUTES <= toMinutes(OPERATING_HOURS.end);
        current += SLOT_DURATION_MINUTES
    ) {
        const slotStart = current;
        const slotEnd = current + SLOT_DURATION_MINUTES;

        const hasConflict = reservedRanges.some((range) => rangesOverlap(slotStart, slotEnd, range.start, range.end));

        if (!hasConflict) {
            const startHours = String(Math.floor(slotStart / 60)).padStart(2, '0');
            const startMinutes = String(slotStart % 60).padStart(2, '0');
            const endHours = String(Math.floor(slotEnd / 60)).padStart(2, '0');
            const endMinutes = String(slotEnd % 60).padStart(2, '0');

            slots.push({
                startTime: `${startHours}:${startMinutes}`,
                endTime: `${endHours}:${endMinutes}`
            });
        }
    }

    return slots;
};

exports.createFacilityReservation = asyncHandler(async (req, res) => {
    const reservationData = pickFields(req.body, reservationFields);
    const validationError = validateReservationData(reservationData);

    if (
        !reservationData.facilityName
        || !reservationData.reservationDate
        || !reservationData.startTime
        || !reservationData.endTime
        || !reservationData.purpose
    ) {
        throw createHttpError(
            400,
            'facilityName, reservationDate, startTime, endTime, and purpose are required',
            { code: 'FACILITY_RESERVATION_VALIDATION_ERROR' }
        );
    }

    if (validationError) {
        throw createHttpError(400, validationError, {
            code: 'FACILITY_RESERVATION_VALIDATION_ERROR'
        });
    }

    const inventoryError = await validateInventoryAvailability(reservationData);

    if (inventoryError) {
        throw createHttpError(409, inventoryError, {
            code: 'FACILITY_RESERVATION_CONFLICT'
        });
    }

    if (!isInventoryFacility(reservationData.facilityName)) {
        const conflictingReservation = await findConflictingReservation(reservationData);

        if (conflictingReservation) {
            throw createHttpError(409, 'This facility is already reserved for the selected date and time.', {
                code: 'FACILITY_RESERVATION_CONFLICT'
            });
        }
    }

    const resident = await Resident.findOne({ userId: req.user.id });

    if (!resident) {
        throw createHttpError(404, 'Resident profile not found. Please complete your profile first.', {
            code: 'FACILITY_RESERVATION_RESIDENT_NOT_FOUND'
        });
    }

    const reservation = await FacilityReservation.create(buildResidentReservationPayload(resident._id, reservationData));

    const populatedReservation = await populateReservation(
        FacilityReservation.findById(reservation._id)
    );

    res.status(201).json(populatedReservation);
});

exports.createPublicFacilityReservation = asyncHandler(async (req, res) => {
    const reservationData = pickFields(req.body, [...reservationFields, ...reservationRequesterFields]);
    const validationError = validateGuestReservationData(reservationData) || validateReservationData(reservationData);

    if (
        !reservationData.facilityName
        || !reservationData.reservationDate
        || !reservationData.startTime
        || !reservationData.endTime
        || !reservationData.purpose
    ) {
        throw createHttpError(
            400,
            'facilityName, reservationDate, startTime, endTime, and purpose are required',
            { code: 'FACILITY_RESERVATION_VALIDATION_ERROR' }
        );
    }

    if (validationError) {
        throw createHttpError(400, validationError, {
            code: 'FACILITY_RESERVATION_VALIDATION_ERROR'
        });
    }

    // Prevent duplicate reservations from same email within 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const existingReservation = await FacilityReservation.findOne({
        email: normalizeEmail(reservationData.email),
        requesterType: 'guest',
        createdAt: { $gte: oneDayAgo }
    });

    if (existingReservation) {
        throw createHttpError(409, 'You already submitted a facility reservation request in the last 24 hours. Please check your email for updates or contact the barangay admin.', {
            code: 'DUPLICATE_REQUEST'
        });
    }

    const inventoryError = await validateInventoryAvailability(reservationData);

    if (inventoryError) {
        throw createHttpError(409, inventoryError, {
            code: 'FACILITY_RESERVATION_CONFLICT'
        });
    }

    if (!isInventoryFacility(reservationData.facilityName)) {
        const conflictingReservation = await findConflictingReservation(reservationData);

        if (conflictingReservation) {
            throw createHttpError(409, 'This facility is already reserved for the selected date and time.', {
                code: 'FACILITY_RESERVATION_CONFLICT'
            });
        }
    }

    const reservation = await FacilityReservation.create(buildGuestReservationPayload(reservationData));
    const populatedReservation = await populateReservation(
        FacilityReservation.findById(reservation._id)
    );

    res.status(201).json(populatedReservation);
});

exports.getMyFacilityReservations = asyncHandler(async (req, res) => {
    const resident = await Resident.findOne({ userId: req.user.id });

    if (!resident) {
        throw createHttpError(404, 'Resident profile not found. Please complete your profile first.', {
            code: 'FACILITY_RESERVATION_RESIDENT_NOT_FOUND'
        });
    }

    const reservations = await populateReservation(
        FacilityReservation.find({ residentId: resident._id }).sort({ createdAt: -1 })
    );

    res.json(reservations);
});

exports.getFacilityAvailability = asyncHandler(async (req, res) => {
    const { facilityName, date, startTime, endTime } = req.query;

    if (!facilityName || !date) {
        throw createHttpError(400, 'facilityName and date are required', {
            code: 'FACILITY_RESERVATION_VALIDATION_ERROR'
        });
    }

    if (!isValidDate(date)) {
        throw createHttpError(400, 'Please provide a valid date', {
            code: 'FACILITY_RESERVATION_VALIDATION_ERROR'
        });
    }

    const inventoryCapacity = getFacilityInventoryCapacity(facilityName);

    const { day, nextDay } = sameDayRange(date);
    const reservations = await FacilityReservation.find({
        facilityName,
        reservationDate: {
            $gte: day,
            $lt: nextDay
        },
        status: { $in: CONFLICT_STATUSES }
    }).sort({ startTime: 1 });

    const inventory = buildInventoryAvailability(reservations);
    const isInventoryView = isInventoryFacility(facilityName) && inventoryCapacity !== null;
    const requestedStart = startTime && isValidTime(startTime) ? startTime : null;
    const requestedEnd = endTime && isValidTime(endTime) ? endTime : null;
    const relevantReservations = isInventoryView && requestedStart && requestedEnd
        ? reservations.filter((reservation) => rangesOverlap(
            toMinutes(requestedStart),
            toMinutes(requestedEnd),
            toMinutes(reservation.startTime),
            toMinutes(reservation.endTime)
        ))
        : reservations;
    const reservedQuantity = isInventoryView
        ? getPeakReservedQuantityForRange(
            relevantReservations,
            requestedStart || OPERATING_HOURS.start,
            requestedEnd || OPERATING_HOURS.end
        )
        : 0;
    const availableQuantity = isInventoryView
        ? Math.max(inventoryCapacity - reservedQuantity, 0)
        : null;

    res.json({
        facilityName,
        date,
        operatingHours: OPERATING_HOURS,
        inventory: FACILITY_INVENTORY,
        inventoryQuantity: inventoryCapacity,
        reservedQuantity,
        availableQuantity,
        selectedAvailability: isInventoryView ? {
            facilityName,
            inventoryQuantity: inventoryCapacity,
            reservedQuantity,
            availableQuantity
        } : null,
        ...inventory,
        reservedSlots: reservations.map((reservation) => ({
            id: reservation._id,
            facilityName: reservation.facilityName,
            startTime: reservation.startTime,
            endTime: reservation.endTime,
            status: reservation.status,
            quantity: getReservationQuantity(reservation)
        })),
        availableSlots: buildAvailableSlots(reservations, isInventoryView)
    });
});

exports.getFacilityReservations = asyncHandler(async (req, res) => {
    const reservations = await populateReservation(
        FacilityReservation.find().sort({ createdAt: -1 })
    );

    res.json(reservations);
});

exports.getFacilityReservationById = asyncHandler(async (req, res) => {
    const reservation = await populateReservation(
        FacilityReservation.findById(req.params.id)
    );

    if (!reservation) {
        throw createHttpError(404, 'Facility reservation not found', {
            code: 'FACILITY_RESERVATION_NOT_FOUND'
        });
    }

    if (req.user.role === 'resident') {
        const resident = await Resident.findOne({ userId: req.user.id });

        if (!reservation.residentId || !resident || reservation.residentId._id.toString() !== resident._id.toString()) {
            throw createHttpError(403, 'Access denied', {
                code: 'FACILITY_RESERVATION_FORBIDDEN'
            });
        }
    }

    res.json(reservation);
});

exports.deleteMyFacilityReservation = asyncHandler(async (req, res) => {
    const terminalStatuses = ['rejected', 'completed', 'cancelled'];
    const adminDeleteStatuses = ['rejected', 'cancelled'];
    const reservation = await FacilityReservation.findById(req.params.id);

    if (!reservation) {
        throw createHttpError(404, 'Facility reservation not found', {
            code: 'FACILITY_RESERVATION_NOT_FOUND'
        });
    }

    const allowedStatuses = req.user.role === 'admin' ? adminDeleteStatuses : terminalStatuses;
    if (!allowedStatuses.includes(reservation.status)) {
        throw createHttpError(400, `Cannot delete reservation with status: ${reservation.status}`, {
            code: 'FACILITY_RESERVATION_DELETE_NOT_ALLOWED'
        });
    }

    if (req.user.role !== 'admin') {
        const resident = await Resident.findOne({ userId: req.user.id });
        if (!resident || reservation.residentId?.toString() !== resident?._id?.toString()) {
            throw createHttpError(403, 'Access denied', {
                code: 'FACILITY_RESERVATION_FORBIDDEN'
            });
        }
    }

    await FacilityReservation.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Facility reservation deleted successfully' });
});

exports.updateFacilityReservationStatus = asyncHandler(async (req, res) => {
    const statusData = pickFields(req.body, reservationStatusFields);

    if (!statusData.status) {
        throw createHttpError(400, 'status is required', {
            code: 'FACILITY_RESERVATION_VALIDATION_ERROR'
        });
    }

    const existingReservation = await FacilityReservation.findById(req.params.id);

    if (!existingReservation) {
        throw createHttpError(404, 'Facility reservation not found', {
            code: 'FACILITY_RESERVATION_NOT_FOUND'
        });
    }

    // Validate status transition
    if (!isValidTransition('facilityReservation', existingReservation.status, statusData.status)) {
        throw createHttpError(400, `Cannot transition from ${existingReservation.status} to ${statusData.status}`, {
            code: 'INVALID_STATUS_TRANSITION'
        });
    }

    const previousStatus = existingReservation.status;

    if (CONFLICT_STATUSES.includes(statusData.status)) {
        if (isInventoryFacility(existingReservation.facilityName)) {
            const inventoryError = await validateInventoryAvailability({
                facilityName: existingReservation.facilityName,
                reservationDate: existingReservation.reservationDate,
                startTime: existingReservation.startTime,
                endTime: existingReservation.endTime,
                quantity: getReservationQuantity(existingReservation),
                excludeReservationId: existingReservation._id
            });

            if (inventoryError) {
                throw createHttpError(409, inventoryError, {
                    code: 'FACILITY_RESERVATION_CONFLICT'
                });
            }
        } else {
            const conflictingReservation = await findConflictingReservation({
                facilityName: existingReservation.facilityName,
                reservationDate: existingReservation.reservationDate,
                startTime: existingReservation.startTime,
                endTime: existingReservation.endTime,
                excludeReservationId: existingReservation._id
            });

            if (conflictingReservation) {
                throw createHttpError(409, 'This facility is already reserved for the selected date and time.', {
                    code: 'FACILITY_RESERVATION_CONFLICT'
                });
            }
        }
    }

    const reservation = await FacilityReservation.findByIdAndUpdate(
        req.params.id,
        statusData,
        { returnDocument: 'after', runValidators: true }
    );

    // Log the status change
    try {
        await logStatusChange(
            'FacilityReservation',
            req.params.id,
            previousStatus,
            statusData.status,
            req.user,
            statusData.adminNotes || '',
            req.ip || req.connection.remoteAddress || ''
        );
    } catch (logError) {
        console.error('Failed to log status change:', logError);
    }

    const populatedReservation = await populateReservation(
        FacilityReservation.findById(reservation._id)
    );

    const recipientEmail = populatedReservation.email || populatedReservation.residentId?.email;

    if (recipientEmail) {
        await sendRequestStatusEmail(
            recipientEmail,
            getReservationRequesterName(populatedReservation),
            'facility reservation',
            statusData.status,
            statusData.adminNotes || '',
            buildReservationEmailDetails(populatedReservation, statusData.status)
        );
    }
    const recipientPhone = populatedReservation.contactNumber || populatedReservation.residentId?.contactNumber;
    if (recipientPhone) {
        await sendRequestStatusSMS(recipientPhone, getReservationRequesterName(populatedReservation), 'facility reservation', statusData.status, {
            messageType: 'facility_reservation',
            recipientId: populatedReservation.residentId?._id,
            referenceId: String(populatedReservation._id || '')
        });
    }

    res.json(populatedReservation);
});
