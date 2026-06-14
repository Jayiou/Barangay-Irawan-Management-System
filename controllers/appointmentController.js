const Appointment = require('../models/Appointment');
const Official = require('../models/Official');
const BlockedSchedule = require('../models/BlockedSchedule');
const Resident = require('../models/Resident');
const asyncHandler = require('../utils/asyncHandler');
const { createHttpError } = require('../utils/httpError');
const { sendRequestStatusEmail } = require('../utils/mailer');
const { sendRequestStatusSMS } = require('../utils/sms');
const { logStatusChange } = require('../utils/statusLogger');
const { persistPublicUpload } = require('../utils/publicUploadStorage');
const { normalizePublicUploadUrl } = require('../utils/uploadPaths');
const {
    getAvailableTimeSlots,
    isTimeSlotAvailable,
    isValidAppointmentDate,
    formatAppointmentResponse,
    formatAppointmentResponseWithNote,
    hasAppointmentExpired,
    expireOldPendingAppointments,
    DEFAULT_TIME_SLOTS
} = require('../utils/appointmentHelpers');
const {
    isValidAppointmentCategory,
    isOfficialAppropriateForCategory
} = require('../utils/appointmentCategories');

const getPersonName = (person, fallback = 'Resident') => {
    const fullName = [
        person?.firstName,
        person?.middleName,
        person?.lastName,
        person?.suffix
    ].filter(Boolean).join(' ').trim();

    return fullName || person?.username || fallback;
};

const normalizeText = (value) => String(value || '').trim();
const normalizeEmail = (value) => normalizeText(value).toLowerCase();

const getAppointmentRequesterName = (appointment) => {
    const guestName = getPersonName(appointment, '');
    if (guestName) {
        return guestName;
    }

    return getPersonName(appointment?.residentId, 'Requester');
};

const getAppointmentRecipientEmail = (appointment) => (
    appointment?.email
    || appointment?.residentId?.email
    || appointment?.residentId?.userId?.email
    || appointment?.userId?.email
    || ''
);

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

const buildAppointmentEmailDetails = (appointment, status) => [
    { label: 'Request Type', value: 'Appointment' },
    { label: 'Category', value: appointment?.category || 'General Inquiries' },
    { label: 'Purpose', value: appointment?.purpose },
    { label: 'Appointment Date', value: formatEmailDate(appointment?.appointmentDate) },
    { label: 'Time Slot', value: appointment?.timeSlot?.startTime && appointment?.timeSlot?.endTime ? `${appointment.timeSlot.startTime}-${appointment.timeSlot.endTime}` : '' },
    { label: 'Official', value: appointment?.officialId?.name },
    { label: 'Official Position', value: appointment?.officialId?.position },
    { label: 'Status', value: status }
];

const getAppointmentAuditData = (appointment) => ({
    residentName: getAppointmentRequesterName(appointment),
    requesterType: appointment?.requesterType || 'resident',
    residentId: appointment?.residentId?._id || appointment?.residentId,
    officialName: appointment?.officialId?.name,
    officialId: appointment?.officialId?._id || appointment?.officialId,
    appointmentDate: appointment?.appointmentDate,
    timeSlot: appointment?.timeSlot,
    category: appointment?.category || 'General Inquiries',
    purpose: appointment?.purpose
});

const logAppointmentStatusChange = async (appointment, previousStatus, newStatus, req, reason = '') => {
    await logStatusChange(
        'Appointment',
        appointment._id,
        previousStatus,
        newStatus,
        req.user,
        reason || '',
        req.ip,
        `Appointment ${newStatus}${reason ? ` (${reason})` : ''}`,
        getAppointmentAuditData(appointment)
    );
};

const notifyAppointmentStatus = async (appointment, status, notes = '') => {
    const recipientEmail = getAppointmentRecipientEmail(appointment);
    const recipientPhone = appointment?.contactNumber || appointment?.residentId?.contactNumber || '';
    const name = getAppointmentRequesterName(appointment);
    const notifications = [];
    if (recipientEmail) notifications.push(sendRequestStatusEmail(
        recipientEmail,
        name,
        'appointment',
        status,
        notes,
        buildAppointmentEmailDetails(appointment, status)
    ));
    if (recipientPhone) notifications.push(sendRequestStatusSMS(recipientPhone, name, 'appointment', status, {
        messageType: 'appointment_confirmation',
        recipientId: appointment?.residentId?._id || appointment?.residentId,
        referenceId: String(appointment?._id || '')
    }));
    await Promise.allSettled(notifications);
};

const isDuplicateSlotError = (error) => (
    error?.code === 11000
    && (
        error?.keyPattern?.slotKey
        || error?.keyValue?.slotKey
        || error?.message?.includes('unique_active_appointment_slot')
    )
);

const getOfficialIdValue = (officialId) => officialId?._id || officialId;

const getAppointmentDayRange = (appointmentDate) => {
    const start = new Date(appointmentDate);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setHours(23, 59, 59, 999);

    return { start, end };
};

const throwSlotAlreadyBooked = () => {
    throw createHttpError(
        409,
        'This appointment slot was just booked by another request. Please choose another time slot.'
    );
};

const getInactiveOfficialMessage = (official) => {
    const reason = String(official?.notes || '').trim() || 'No reason provided';
    return `This official is currently inactive: ${reason}`;
};

const serializeOfficial = (official) => {
    if (!official) {
        return official;
    }

    const output = official.toObject ? official.toObject() : { ...official };
    const normalizedPicture = normalizePublicUploadUrl(output.picture);

    if (normalizedPicture) {
        output.picture = normalizedPicture;
    } else {
        delete output.picture;
    }

    return output;
};

const validateGuestAppointmentData = (payload) => {
    const required = ['firstName', 'lastName', 'contactNumber', 'email', 'address'];

    if (required.some((field) => !normalizeText(payload[field]))) {
        return 'firstName, lastName, contactNumber, email, and address are required';
    }

    return null;
};

// ============================================
// ADMIN - OFFICIAL MANAGEMENT
// ============================================

/**
 * Get all officials
 */
const getAllOfficials = asyncHandler(async (req, res) => {
    const officials = await Official.find().sort({ createdAt: -1 });

    res.status(200).json({
        success: true,
        message: 'Officials retrieved successfully',
        data: officials.map(serializeOfficial)
    });
});

/**
 * Get single official
 */
const getOfficial = asyncHandler(async (req, res) => {
    const official = await Official.findById(req.params.id);

    if (!official) {
        throw createHttpError(404, 'Official not found');
    }

    res.status(200).json({
        success: true,
        message: 'Official retrieved successfully',
        data: serializeOfficial(official)
    });
});

/**
 * Create official
 */
const createOfficial = asyncHandler(async (req, res) => {
    const { name, position, email, contactNumber, status, notes } = req.body;

    // Validate required fields
    if (!name || !position) {
        throw createHttpError(400, 'Name and position are required');
    }

    const officialData = {
        name,
        position,
        email: email || '',
        contactNumber: contactNumber || '',
        status: status || 'active',
        notes: notes || ''
    };

    if (req.file) {
        await persistPublicUpload(req.file);
        officialData.picture = `/uploads/${req.file.filename}`;
    }

    const official = new Official(officialData);

    await official.save();

    res.status(201).json({
        success: true,
        message: 'Official created successfully',
        data: serializeOfficial(official)
    });
});

/**
 * Update official
 */
const updateOfficial = asyncHandler(async (req, res) => {
    const { name, position, email, contactNumber, status, notes, officeHours } = req.body;

    const official = await Official.findById(req.params.id);

    if (!official) {
        throw createHttpError(404, 'Official not found');
    }

    // Update fields
    if (name) official.name = name;
    if (position) official.position = position;
    if (email !== undefined) official.email = email;
    if (contactNumber !== undefined) official.contactNumber = contactNumber;
    if (status) official.status = status;
    if (notes !== undefined) official.notes = notes;
    if (officeHours) official.officeHours = { ...official.officeHours, ...officeHours };
    if (req.file) {
        await persistPublicUpload(req.file);
        official.picture = `/uploads/${req.file.filename}`;
    }

    official.updatedAt = new Date();
    await official.save();

    res.status(200).json({
        success: true,
        message: 'Official updated successfully',
        data: serializeOfficial(official)
    });
});

/**
 * Delete official
 */
const deleteOfficial = asyncHandler(async (req, res) => {
    const official = await Official.findByIdAndDelete(req.params.id);

    if (!official) {
        throw createHttpError(404, 'Official not found');
    }

    // Clean up related appointments and blocked schedules
    await Appointment.deleteMany({ officialId: req.params.id });
    await BlockedSchedule.deleteMany({ officialId: req.params.id });

    res.status(200).json({
        success: true,
        message: 'Official deleted successfully'
    });
});

// ============================================
// ADMIN - BLOCKED SCHEDULES MANAGEMENT
// ============================================

/**
 * Get blocked schedules for an official
 */
const getBlockedSchedules = asyncHandler(async (req, res) => {
    const { officialId } = req.params;
    const { fromDate, toDate } = req.query;

    const query = { officialId };

    if (fromDate || toDate) {
        query.blockedDate = {};
        if (fromDate) {
            const from = new Date(fromDate);
            from.setHours(0, 0, 0, 0);
            query.blockedDate.$gte = from;
        }
        if (toDate) {
            const to = new Date(toDate);
            to.setHours(23, 59, 59, 999);
            query.blockedDate.$lte = to;
        }
    }

    const blockedSchedules = await BlockedSchedule.find(query).sort({ blockedDate: 1 });

    res.status(200).json({
        success: true,
        message: 'Blocked schedules retrieved successfully',
        data: blockedSchedules
    });
});

/**
 * Create blocked schedule
 */
const createBlockedSchedule = asyncHandler(async (req, res) => {
    const { officialId, blockedDate, startTime, endTime, note, reason } = req.body;

    // Validate required fields
    if (!officialId || !blockedDate || !startTime || !endTime) {
        throw createHttpError(
            400,
            'officialId, blockedDate, startTime, and endTime are required'
        );
    }

    // Verify official exists
    const official = await Official.findById(officialId);
    if (!official) {
        throw createHttpError(404, 'Official not found');
    }

    const blockedSchedule = new BlockedSchedule({
        officialId,
        blockedDate: new Date(blockedDate),
        startTime,
        endTime,
        note: note || '',
        reason: reason || ''
    });

    await blockedSchedule.save();

    res.status(201).json({
        success: true,
        message: 'Blocked schedule created successfully',
        data: blockedSchedule
    });
});

/**
 * Update blocked schedule
 */
const updateBlockedSchedule = asyncHandler(async (req, res) => {
    const { startTime, endTime, note, reason } = req.body;

    const blockedSchedule = await BlockedSchedule.findById(req.params.id);

    if (!blockedSchedule) {
        throw createHttpError(404, 'Blocked schedule not found');
    }

    if (startTime) blockedSchedule.startTime = startTime;
    if (endTime) blockedSchedule.endTime = endTime;
    if (note !== undefined) blockedSchedule.note = note;
    if (reason !== undefined) blockedSchedule.reason = reason;

    blockedSchedule.updatedAt = new Date();
    await blockedSchedule.save();

    res.status(200).json({
        success: true,
        message: 'Blocked schedule updated successfully',
        data: blockedSchedule
    });
});

/**
 * Delete blocked schedule
 */
const deleteBlockedSchedule = asyncHandler(async (req, res) => {
    const blockedSchedule = await BlockedSchedule.findByIdAndDelete(req.params.id);

    if (!blockedSchedule) {
        throw createHttpError(404, 'Blocked schedule not found');
    }

    res.status(200).json({
        success: true,
        message: 'Blocked schedule deleted successfully'
    });
});

// ============================================
// RESIDENT - REQUEST APPOINTMENT
// ============================================

/**
 * Get available time slots for an official on a specific date
 */
const getAvailableSlots = asyncHandler(async (req, res) => {
    const { officialId, appointmentDate } = req.query;

    if (!officialId || !appointmentDate) {
        throw createHttpError(400, 'officialId and appointmentDate are required');
    }

    const official = await Official.findById(officialId);
    if (!official) {
        throw createHttpError(404, 'Official not found');
    }

    if (official.status !== 'active') {
        throw createHttpError(400, getInactiveOfficialMessage(official));
    }

    const availableSlots = await getAvailableTimeSlots(officialId, appointmentDate);

    res.status(200).json({
        success: true,
        message: 'Available time slots retrieved successfully',
        data: availableSlots
    });
});

/**
 * Request appointment
 */
const requestAppointment = asyncHandler(async (req, res) => {
    const { category, officialId, appointmentDate, startTime, endTime, purpose } = req.body;
    const userId = req.user._id;

    // Validate required fields
    if (!category || !officialId || !appointmentDate || !startTime || !endTime || !purpose) {
        throw createHttpError(
            400,
            'category, officialId, appointmentDate, startTime, endTime, and purpose are required'
        );
    }

    if (!isValidAppointmentCategory(category)) {
        throw createHttpError(400, 'Please choose a valid appointment category');
    }

    // Get resident info
    const resident = await Resident.findOne({ userId });
    if (!resident) {
        throw createHttpError(404, 'Resident profile not found');
    }

    // Verify official exists and is active
    const official = await Official.findById(officialId);
    if (!official) {
        throw createHttpError(404, 'Official not found');
    }

    if (official.status !== 'active') {
        throw createHttpError(400, getInactiveOfficialMessage(official));
    }

    if (!isOfficialAppropriateForCategory(official, category)) {
        throw createHttpError(400, 'The selected official does not handle this appointment category');
    }

    // Validate appointment date
    if (!isValidAppointmentDate(appointmentDate)) {
        throw createHttpError(400, 'Appointment date must be at least 1 day in the future');
    }

    const isSupportedTimeSlot = DEFAULT_TIME_SLOTS.some((slot) => (
        slot.startTime === startTime && slot.endTime === endTime
    ));

    if (!isSupportedTimeSlot) {
        throw createHttpError(400, 'Please choose one of the available appointment time slots');
    }

    // Check if time slot is available
    const availability = await isTimeSlotAvailable(officialId, appointmentDate, startTime, endTime);
    if (!availability.available) {
        throw createHttpError(400, availability.reason);
    }

    // Create appointment
    const appointment = new Appointment({
        residentId: resident._id,
        userId,
        officialId,
        category,
        appointmentDate: new Date(appointmentDate),
        timeSlot: {
            startTime,
            endTime
        },
        purpose,
        status: 'pending'
    });

    try {
        await appointment.save();
    } catch (error) {
        if (isDuplicateSlotError(error)) {
            throwSlotAlreadyBooked();
        }

        throw error;
    }

    res.status(201).json({
        success: true,
        message: 'Appointment request submitted successfully',
        data: formatAppointmentResponse(appointment)
    });
});

/**
 * Request appointment without resident registration
 */
const requestPublicAppointment = asyncHandler(async (req, res) => {
    const {
        category,
        officialId,
        appointmentDate,
        startTime,
        endTime,
        purpose,
        firstName,
        middleName,
        lastName,
        suffix,
        contactNumber,
        email,
        address
    } = req.body;

    if (!category || !officialId || !appointmentDate || !startTime || !endTime || !purpose) {
        throw createHttpError(
            400,
            'category, officialId, appointmentDate, startTime, endTime, and purpose are required'
        );
    }

    if (!isValidAppointmentCategory(category)) {
        throw createHttpError(400, 'Please choose a valid appointment category');
    }

    const validationError = validateGuestAppointmentData(req.body);
    if (validationError) {
        throw createHttpError(400, validationError);
    }

    const official = await Official.findById(officialId);
    if (!official) {
        throw createHttpError(404, 'Official not found');
    }

    if (official.status !== 'active') {
        throw createHttpError(400, getInactiveOfficialMessage(official));
    }

    if (!isOfficialAppropriateForCategory(official, category)) {
        throw createHttpError(400, 'The selected official does not handle this appointment category');
    }

    if (!isValidAppointmentDate(appointmentDate)) {
        throw createHttpError(400, 'Appointment date must be at least 1 day in the future');
    }

    const isSupportedTimeSlot = DEFAULT_TIME_SLOTS.some((slot) => (
        slot.startTime === startTime && slot.endTime === endTime
    ));

    if (!isSupportedTimeSlot) {
        throw createHttpError(400, 'Please choose one of the available appointment time slots');
    }

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const existingAppointment = await Appointment.findOne({
        email: normalizeEmail(email),
        requesterType: 'guest',
        createdAt: { $gte: oneDayAgo }
    });

    if (existingAppointment) {
        throw createHttpError(409, 'You already submitted an appointment request in the last 24 hours. Please check your email for updates or contact the barangay admin.', {
            code: 'DUPLICATE_REQUEST'
        });
    }

    const availability = await isTimeSlotAvailable(officialId, appointmentDate, startTime, endTime);
    if (!availability.available) {
        throw createHttpError(400, availability.reason);
    }

    const appointment = new Appointment({
        residentId: null,
        userId: null,
        requesterType: 'guest',
        firstName: normalizeText(firstName),
        middleName: normalizeText(middleName),
        lastName: normalizeText(lastName),
        suffix: normalizeText(suffix),
        contactNumber: normalizeText(contactNumber),
        email: normalizeEmail(email),
        address: normalizeText(address),
        officialId,
        category,
        appointmentDate: new Date(appointmentDate),
        timeSlot: {
            startTime,
            endTime
        },
        purpose: normalizeText(purpose),
        status: 'pending'
    });

    try {
        await appointment.save();
    } catch (error) {
        if (isDuplicateSlotError(error)) {
            throwSlotAlreadyBooked();
        }

        throw error;
    }

    res.status(201).json({
        success: true,
        message: 'Appointment request submitted successfully',
        data: formatAppointmentResponse(appointment)
    });
});

/**
 * Get my appointments (resident)
 */
const getMyAppointments = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { status } = req.query;

    const resident = await Resident.findOne({ userId });
    if (!resident) {
        throw createHttpError(404, 'Resident profile not found');
    }

    const query = { residentId: resident._id };
    if (status) {
        query.status = status;
    }

    const appointments = await Appointment.find(query)
        .populate('officialId', 'name position')
        .sort({ createdAt: -1 });

    res.status(200).json({
        success: true,
        message: 'Appointments retrieved successfully',
        data: appointments.map(formatAppointmentResponse)
    });
});

/**
 * Get appointment details
 */
const getAppointmentDetail = asyncHandler(async (req, res) => {
    const appointment = await Appointment.findById(req.params.id)
        .populate('officialId', 'name position email contactNumber')
        .populate('residentId', 'firstName middleName lastName suffix contactNumber email address');

    if (!appointment) {
        throw createHttpError(404, 'Appointment not found');
    }

    if (req.user.role === 'resident') {
        const resident = await Resident.findOne({ userId: req.user._id || req.user.id });

        if (!appointment.residentId || !resident || appointment.residentId._id.toString() !== resident._id.toString()) {
            throw createHttpError(403, 'You do not have permission to view this appointment');
        }
    }

    // Use the formatter that includes system notes for expired appointments
    const formatted = formatAppointmentResponseWithNote(appointment);

    res.status(200).json({
        success: true,
        message: 'Appointment retrieved successfully',
        data: formatted
    });
});

/**
 * Cancel appointment (resident)
 */
const cancelAppointment = asyncHandler(async (req, res) => {
    const { cancellationReason } = req.body;
    const userId = req.user._id;

    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
        throw createHttpError(404, 'Appointment not found');
    }

    // Verify ownership
    const resident = appointment.residentId ? await Resident.findById(appointment.residentId) : null;
    if (!resident || resident.userId.toString() !== userId.toString()) {
        throw createHttpError(403, 'You do not have permission to cancel this appointment');
    }

    // Only allow cancellation of pending or approved appointments
    if (!['pending', 'approved'].includes(appointment.status)) {
        throw createHttpError(
            400,
            `Cannot cancel appointment with status: ${appointment.status}`
        );
    }

    const previousStatus = appointment.status;
    appointment.status = 'cancelled';
    appointment.cancellationReason = cancellationReason || '';
    appointment.cancelledAt = new Date();
    appointment.updatedAt = new Date();

    await appointment.save();
    await logAppointmentStatusChange(appointment, previousStatus, 'cancelled', req, cancellationReason || 'Cancelled by resident');

    res.status(200).json({
        success: true,
        message: 'Appointment cancelled successfully',
        data: formatAppointmentResponse(appointment)
    });
});

/**
 * Delete appointment from resident history after it reaches a terminal state
 */
const deleteMyAppointment = asyncHandler(async (req, res) => {
    const terminalStatuses = ['rejected', 'cancelled', 'completed', 'expired'];
    const adminDeleteStatuses = ['rejected', 'cancelled'];
    const userId = req.user._id;
    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
        throw createHttpError(404, 'Appointment not found');
    }

    const allowedStatuses = req.user.role === 'admin' ? adminDeleteStatuses : terminalStatuses;
    if (!allowedStatuses.includes(appointment.status)) {
        throw createHttpError(400, `Cannot delete appointment with status: ${appointment.status}`);
    }

    if (req.user.role !== 'admin') {
        const resident = await Resident.findById(appointment.residentId);
        if (!resident || resident.userId.toString() !== userId.toString()) {
            throw createHttpError(403, 'You do not have permission to delete this appointment');
        }
    }

    await Appointment.findByIdAndDelete(req.params.id);

    res.status(200).json({
        success: true,
        message: 'Appointment deleted successfully'
    });
});

// ============================================
// ADMIN - APPOINTMENT MANAGEMENT
// ============================================

/**
 * Get all appointments
 */
const getAllAppointments = asyncHandler(async (req, res) => {
    const { status, officialId, fromDate, toDate } = req.query;

    // Expire old pending appointments
    await expireOldPendingAppointments(24);

    const query = {};

    if (status) {
        query.status = status;
    }

    if (officialId) {
        query.officialId = officialId;
    }

    if (fromDate || toDate) {
        query.appointmentDate = {};
        if (fromDate) {
            const from = new Date(fromDate);
            from.setHours(0, 0, 0, 0);
            query.appointmentDate.$gte = from;
        }
        if (toDate) {
            const to = new Date(toDate);
            to.setHours(23, 59, 59, 999);
            query.appointmentDate.$lte = to;
        }
    }

    const appointments = await Appointment.find(query)
        .populate('residentId', 'firstName middleName lastName suffix contactNumber email address')
        .populate('officialId', 'name position')
        .sort({ createdAt: -1 });

    res.status(200).json({
        success: true,
        message: 'Appointments retrieved successfully',
        data: appointments.map(formatAppointmentResponse)
    });
});

/**
 * Approve appointment
 */
const approveAppointment = asyncHandler(async (req, res) => {
    const { remarks } = req.body;

    const appointment = await Appointment.findById(req.params.id)
        .populate({
            path: 'residentId',
            select: 'firstName middleName lastName suffix email userId',
            populate: { path: 'userId', select: 'email username' }
        })
        .populate('officialId', 'name position')
        .populate('userId', 'email username');

    if (!appointment) {
        throw createHttpError(404, 'Appointment not found');
    }

    if (appointment.status !== 'pending') {
        throw createHttpError(400, 'Only pending appointments can be approved');
    }

    const { start, end } = getAppointmentDayRange(appointment.appointmentDate);
    const approvedSlotConflict = await Appointment.findOne({
        _id: { $ne: appointment._id },
        officialId: getOfficialIdValue(appointment.officialId),
        appointmentDate: {
            $gte: start,
            $lte: end
        },
        'timeSlot.startTime': { $lt: appointment.timeSlot.endTime },
        'timeSlot.endTime': { $gt: appointment.timeSlot.startTime },
        status: { $in: ['approved', 'completed'] }
    });

    if (approvedSlotConflict) {
        throwSlotAlreadyBooked();
    }

    const previousStatus = appointment.status;
    appointment.status = 'approved';
    appointment.remarks = remarks || '';
    appointment.approvedAt = new Date();
    appointment.updatedAt = new Date();

    try {
        await appointment.save();
    } catch (error) {
        if (isDuplicateSlotError(error)) {
            throwSlotAlreadyBooked();
        }

        throw error;
    }

    await logAppointmentStatusChange(appointment, previousStatus, 'approved', req, remarks || '');
    await notifyAppointmentStatus(appointment, 'approved', remarks || '');

    res.status(200).json({
        success: true,
        message: 'Appointment approved successfully',
        data: formatAppointmentResponse(appointment)
    });
});

/**
 * Reject appointment
 */
const rejectAppointment = asyncHandler(async (req, res) => {
    const { rejectionReason, remarks } = req.body;

    const appointment = await Appointment.findById(req.params.id)
        .populate({
            path: 'residentId',
            select: 'firstName middleName lastName suffix email userId',
            populate: { path: 'userId', select: 'email username' }
        })
        .populate('officialId', 'name position')
        .populate('userId', 'email username');

    if (!appointment) {
        throw createHttpError(404, 'Appointment not found');
    }

    if (appointment.status !== 'pending') {
        throw createHttpError(400, 'Only pending appointments can be rejected');
    }

    const previousStatus = appointment.status;
    appointment.status = 'rejected';
    appointment.rejectionReason = rejectionReason || '';
    appointment.remarks = remarks || '';
    appointment.rejectedAt = new Date();
    appointment.updatedAt = new Date();

    await appointment.save();
    await logAppointmentStatusChange(appointment, previousStatus, 'rejected', req, rejectionReason || remarks || '');
    await notifyAppointmentStatus(appointment, 'rejected', rejectionReason || remarks || '');

    res.status(200).json({
        success: true,
        message: 'Appointment rejected successfully',
        data: formatAppointmentResponse(appointment)
    });
});

/**
 * Mark appointment as completed
 */
const completeAppointment = asyncHandler(async (req, res) => {
    const { remarks } = req.body;

    const appointment = await Appointment.findById(req.params.id)
        .populate({
            path: 'residentId',
            select: 'firstName middleName lastName suffix email userId',
            populate: { path: 'userId', select: 'email username' }
        })
        .populate('officialId', 'name position')
        .populate('userId', 'email username');

    if (!appointment) {
        throw createHttpError(404, 'Appointment not found');
    }

    if (appointment.status !== 'approved') {
        throw createHttpError(400, 'Only approved appointments can be marked as completed');
    }

    const previousStatus = appointment.status;
    appointment.status = 'completed';
    appointment.remarks = remarks || '';
    appointment.completedAt = new Date();
    appointment.updatedAt = new Date();

    await appointment.save();
    await logAppointmentStatusChange(appointment, previousStatus, 'completed', req, remarks || '');
    await notifyAppointmentStatus(appointment, 'completed', remarks || '');

    res.status(200).json({
        success: true,
        message: 'Appointment marked as completed',
        data: formatAppointmentResponse(appointment)
    });
});

/**
 * Admin cancel appointment
 */
const adminCancelAppointment = asyncHandler(async (req, res) => {
    const { cancellationReason, remarks } = req.body;

    const appointment = await Appointment.findById(req.params.id)
        .populate({
            path: 'residentId',
            select: 'firstName middleName lastName suffix email userId',
            populate: { path: 'userId', select: 'email username' }
        })
        .populate('officialId', 'name position')
        .populate('userId', 'email username');

    if (!appointment) {
        throw createHttpError(404, 'Appointment not found');
    }

    if (!['pending', 'approved'].includes(appointment.status)) {
        throw createHttpError(
            400,
            `Cannot cancel appointment with status: ${appointment.status}`
        );
    }

    const previousStatus = appointment.status;
    appointment.status = 'cancelled';
    appointment.cancellationReason = cancellationReason || '';
    appointment.remarks = remarks || '';
    appointment.cancelledAt = new Date();
    appointment.updatedAt = new Date();

    await appointment.save();
    await logAppointmentStatusChange(appointment, previousStatus, 'cancelled', req, cancellationReason || remarks || '');
    await notifyAppointmentStatus(appointment, 'cancelled', cancellationReason || remarks || '');

    res.status(200).json({
        success: true,
        message: 'Appointment cancelled successfully',
        data: formatAppointmentResponse(appointment)
    });
});

module.exports = {
    // Officials
    getAllOfficials,
    getOfficial,
    createOfficial,
    updateOfficial,
    deleteOfficial,
    // Blocked Schedules
    getBlockedSchedules,
    createBlockedSchedule,
    updateBlockedSchedule,
    deleteBlockedSchedule,
    // Resident Appointments
    getAvailableSlots,
    requestAppointment,
    requestPublicAppointment,
    getMyAppointments,
    getAppointmentDetail,
    cancelAppointment,
    deleteMyAppointment,
    // Admin Appointments
    getAllAppointments,
    approveAppointment,
    rejectAppointment,
    completeAppointment,
    adminCancelAppointment
};
