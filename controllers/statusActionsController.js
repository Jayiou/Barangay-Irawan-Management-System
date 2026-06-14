const FacilityReservation = require('../models/FacilityReservation');
const Report = require('../models/Report');
const DocumentRequest = require('../models/DocumentRequest');
const asyncHandler = require('../utils/asyncHandler');
const { createHttpError } = require('../utils/httpError');
const { isValidTransition } = require('../utils/statusWorkflows');
const { logStatusChange } = require('../utils/statusLogger');
const { sendDocumentStatusEmail, sendRequestStatusEmail } = require('../utils/mailer');
const { sendDocumentStatusSMS, sendSmsNotification } = require('../utils/sms');

const getPersonName = (person, fallback = 'Resident') => {
    const fullName = [
        person?.firstName,
        person?.middleName,
        person?.lastName,
        person?.suffix
    ].filter(Boolean).join(' ').trim();

    return fullName || person?.username || fallback;
};

const getRecipientEmail = (record) => (
    record?.email
    || record?.residentId?.email
    || record?.residentId?.userId?.email
    || record?.resident?.email
    || record?.resident?.userId?.email
    || record?.userId?.email
    || ''
);

const formatLabel = (value) => String(value || '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

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

const getReservationQuantity = (reservation) => {
    const quantity = Number(reservation?.quantity);
    if (Number.isFinite(quantity) && quantity > 0) return String(quantity);

    const quantities = [
        ['Chairs', reservation?.chairQuantity],
        ['Tents', reservation?.tentQuantity],
        ['Tables', reservation?.tableQuantity]
    ]
        .filter(([, value]) => Number(value) > 0)
        .map(([label, value]) => `${label}: ${value}`);

    return quantities.join(', ');
};

const buildReservationEmailDetails = (reservation, status) => [
    { label: 'Request Type', value: 'Facility Reservation' },
    { label: 'Facility', value: formatLabel(reservation?.facilityName) },
    { label: 'Reservation Date', value: formatEmailDate(reservation?.reservationDate) },
    { label: 'Time Slot', value: reservation?.startTime && reservation?.endTime ? `${reservation.startTime}-${reservation.endTime}` : '' },
    { label: 'Quantity', value: getReservationQuantity(reservation) },
    { label: 'Purpose', value: reservation?.purpose },
    { label: 'Status', value: formatLabel(status) }
];

const buildReportEmailDetails = (report, status) => [
    { label: 'Request Type', value: 'Report / Complaint' },
    { label: 'Title', value: report?.title },
    { label: 'Report Type', value: formatLabel(report?.reportType) },
    { label: 'Location', value: report?.locationText },
    { label: 'Priority', value: formatLabel(report?.priority) },
    { label: 'Date', value: formatEmailDate(report?.incidentDate) },
    { label: 'Status', value: formatLabel(status) }
];

const getDocumentField = (documentRequest, key) => {
    if (!documentRequest?.fields) return '';
    if (typeof documentRequest.fields.get === 'function') {
        return documentRequest.fields.get(key) || '';
    }

    return documentRequest.fields[key] || '';
};

const buildDocumentEmailDetails = (documentRequest, status) => [
    { label: 'Request Type', value: 'Document Request' },
    { label: 'Document Type', value: formatLabel(documentRequest?.type) },
    { label: 'Purpose', value: documentRequest?.purpose || getDocumentField(documentRequest, 'PURPOSE') },
    { label: 'Submitted Name', value: getDocumentField(documentRequest, 'FULL_NAME') },
    { label: 'Status', value: formatLabel(status) }
];

const notifyRequestStatus = async (record, requestLabel, status, notes = '', details = []) => {
    const recipientEmail = getRecipientEmail(record);
    const requester = record?.residentId || record?.resident || record;
    if (recipientEmail) await sendRequestStatusEmail(
        recipientEmail,
        getPersonName(requester, 'Resident'),
        requestLabel,
        status,
        notes,
        details
    );
    const getRecipientPhone = (rec) => (
        rec?.contactNumber
        || rec?.residentId?.contactNumber
        || rec?.resident?.contactNumber
        || rec?.phone
        || ''
    );

    const phone = getRecipientPhone(record);
    if (!phone) return;

    const name = getPersonName(requester, 'Resident');
    const humanStatus = formatLabel(status);
    const message = `Brgy Irawan: Hi ${name}, your ${requestLabel} is ${humanStatus}. Please check your email for full details.`;

    let messageType = 'resident_update';
    if (String(requestLabel).toLowerCase().includes('facility')) messageType = 'facility_reservation';
    else if (String(requestLabel).toLowerCase().includes('report')) messageType = 'report_status';
    else if (String(requestLabel).toLowerCase().includes('document')) messageType = 'document_status';

    await sendSmsNotification({
        phoneNumber: phone,
        messageType,
        messageContent: message,
        recipientId: requester?._id || undefined,
        referenceId: String(record?._id || '')
    });
};

const notifyDocumentStatus = async (documentRequest, status, notes = '') => {
    const recipientEmail = getRecipientEmail(documentRequest);
    const recipientPhone = documentRequest?.resident?.contactNumber || documentRequest?.contactNumber || '';

    if (recipientEmail) await sendDocumentStatusEmail(
        recipientEmail,
        getPersonName(documentRequest.resident, 'Resident'),
        documentRequest.type,
        status,
        notes,
        buildDocumentEmailDetails(documentRequest, status)
    );

    if (recipientPhone) {
        await sendDocumentStatusSMS(
            recipientPhone,
            getPersonName(documentRequest.resident, 'Resident'),
            documentRequest.type,
            status,
            String(documentRequest._id || '')
        );
    }
};

// ============ FACILITY RESERVATION ACTIONS ============

exports.approveFacilityReservation = asyncHandler(async (req, res) => {
    const res_obj = await FacilityReservation.findById(req.params.id).populate({
        path: 'residentId',
        select: 'firstName middleName lastName suffix email contactNumber userId',
        populate: { path: 'userId', select: 'email username' }
    });

    if (!res_obj) {
        throw createHttpError(404, 'Facility reservation not found');
    }

    if (!isValidTransition('facilityReservation', res_obj.status, 'approved')) {
        throw createHttpError(400, `Cannot approve reservation with status: ${res_obj.status}`);
    }

    const previousStatus = res_obj.status;
    res_obj.status = 'approved';
    await res_obj.save();

    // Log change
    await logStatusChange('FacilityReservation', res_obj._id, previousStatus, 'approved', req.user, '', req.ip);
    await notifyRequestStatus(res_obj, 'facility reservation', 'approved', '', buildReservationEmailDetails(res_obj, 'approved'));

    res.json({ success: true, message: 'Facility reservation approved', data: res_obj });
});

exports.rejectFacilityReservation = asyncHandler(async (req, res) => {
    const { reason } = req.body;

    if (!reason?.trim()) {
        throw createHttpError(400, 'Reason for rejection is required');
    }

    const res_obj = await FacilityReservation.findById(req.params.id).populate({
        path: 'residentId',
        select: 'firstName middleName lastName suffix email contactNumber userId',
        populate: { path: 'userId', select: 'email username' }
    });

    if (!res_obj) {
        throw createHttpError(404, 'Facility reservation not found');
    }

    if (!isValidTransition('facilityReservation', res_obj.status, 'rejected')) {
        throw createHttpError(400, `Cannot reject reservation with status: ${res_obj.status}`);
    }

    const previousStatus = res_obj.status;
    res_obj.status = 'rejected';
    res_obj.adminNotes = reason;
    await res_obj.save();

    // Log change
    await logStatusChange('FacilityReservation', res_obj._id, previousStatus, 'rejected', req.user, reason, req.ip);
    await notifyRequestStatus(res_obj, 'facility reservation', 'rejected', reason, buildReservationEmailDetails(res_obj, 'rejected'));

    res.json({ success: true, message: 'Facility reservation rejected', data: res_obj });
});

exports.completeFacilityReservation = asyncHandler(async (req, res) => {
    const res_obj = await FacilityReservation.findById(req.params.id).populate({
        path: 'residentId',
        select: 'firstName middleName lastName suffix email contactNumber userId',
        populate: { path: 'userId', select: 'email username' }
    });

    if (!res_obj) {
        throw createHttpError(404, 'Facility reservation not found');
    }

    if (!isValidTransition('facilityReservation', res_obj.status, 'completed')) {
        throw createHttpError(400, `Cannot complete reservation from status: ${res_obj.status}`);
    }

    const previousStatus = res_obj.status;
    res_obj.status = 'completed';
    await res_obj.save();

    // Log change
    await logStatusChange('FacilityReservation', res_obj._id, previousStatus, 'completed', req.user, '', req.ip);
    await notifyRequestStatus(res_obj, 'facility reservation', 'completed', '', buildReservationEmailDetails(res_obj, 'completed'));

    res.json({ success: true, message: 'Facility reservation marked as completed', data: res_obj });
});

// ============ DOCUMENT REQUEST ACTIONS ============

const updateDocumentRequestStatus = async (req, res, targetStatus, message) => {
    const { reason } = req.body;
    const documentRequest = await DocumentRequest.findById(req.params.id).populate({
        path: 'resident',
        select: 'firstName middleName lastName suffix email contactNumber userId',
        populate: { path: 'userId', select: 'email username' }
    });

    if (!documentRequest) {
        throw createHttpError(404, 'Document request not found');
    }

    if (targetStatus === 'rejected' && !reason?.trim()) {
        throw createHttpError(400, 'Reason for rejection is required');
    }

    if (!isValidTransition('documentRequest', documentRequest.status, targetStatus)) {
        throw createHttpError(400, `Cannot transition document request from ${documentRequest.status} to ${targetStatus}`);
    }

    const previousStatus = documentRequest.status;
    documentRequest.status = targetStatus;
    if (targetStatus === 'rejected') {
        documentRequest.adminNotes = reason;
    }
    await documentRequest.save();

    // Build detailed action description
    const residentName = documentRequest.resident 
        ? `${documentRequest.resident.firstName} ${documentRequest.resident.lastName}`
        : 'Unknown Resident';
    const actionDescription = documentRequest.type + ' document - ' + targetStatus + (reason ? ' (' + reason + ')' : '');
    
    // Prepare additional data for audit log
    const additionalData = {
        documentType: documentRequest.type,
        residentName,
        residentId: documentRequest.resident?._id,
        purpose: documentRequest.purpose
    };

    await logStatusChange(
        'DocumentRequest',
        documentRequest._id,
        previousStatus,
        targetStatus,
        req.user,
        reason || '',
        req.ip,
        actionDescription,
        additionalData
    );
    await notifyDocumentStatus(documentRequest, targetStatus, reason || documentRequest.adminNotes || '');

    res.json({ success: true, message, data: documentRequest });
};

exports.approveDocumentRequest = asyncHandler(async (req, res) => {
    await updateDocumentRequestStatus(req, res, 'approved', 'Document request approved');
});

exports.rejectDocumentRequest = asyncHandler(async (req, res) => {
    await updateDocumentRequestStatus(req, res, 'rejected', 'Document request rejected');
});

exports.processDocumentRequest = asyncHandler(async (req, res) => {
    await updateDocumentRequestStatus(req, res, 'processing', 'Document request marked as processing');
});

exports.readyDocumentRequest = asyncHandler(async (req, res) => {
    await updateDocumentRequestStatus(req, res, 'ready_for_pickup', 'Document request marked as ready for pickup');
});

exports.completeDocumentRequest = asyncHandler(async (req, res) => {
    await updateDocumentRequestStatus(req, res, 'completed', 'Document request marked as completed');
});

// ============ REPORT ACTIONS ============

exports.startReviewReport = asyncHandler(async (req, res) => {
    const report = await Report.findById(req.params.id).populate({
        path: 'residentId',
        select: 'firstName middleName lastName suffix email contactNumber userId',
        populate: { path: 'userId', select: 'email username' }
    });

    if (!report) {
        throw createHttpError(404, 'Report not found');
    }

    if (!isValidTransition('report', report.status, 'reviewing')) {
        throw createHttpError(400, `Cannot review report with status: ${report.status}`);
    }

    const previousStatus = report.status;
    report.status = 'reviewing';
    await report.save();

    // Log change
    await logStatusChange('Report', report._id, previousStatus, 'reviewing', req.user, '', req.ip);
    await notifyRequestStatus(report, 'report', 'reviewing', '', buildReportEmailDetails(report, 'reviewing'));

    res.json({ success: true, message: 'Report marked as reviewing', data: report });
});

exports.startProgressReport = asyncHandler(async (req, res) => {
    const report = await Report.findById(req.params.id).populate({
        path: 'residentId',
        select: 'firstName middleName lastName suffix email contactNumber userId',
        populate: { path: 'userId', select: 'email username' }
    });

    if (!report) {
        throw createHttpError(404, 'Report not found');
    }

    if (!isValidTransition('report', report.status, 'in_progress')) {
        throw createHttpError(400, `Cannot mark in progress from status: ${report.status}`);
    }

    const previousStatus = report.status;
    report.status = 'in_progress';
    await report.save();

    // Log change
    await logStatusChange('Report', report._id, previousStatus, 'in_progress', req.user, '', req.ip);
    await notifyRequestStatus(report, 'report', 'in_progress', '', buildReportEmailDetails(report, 'in_progress'));

    res.json({ success: true, message: 'Report marked as in progress', data: report });
});

exports.resolveReport = asyncHandler(async (req, res) => {
    const report = await Report.findById(req.params.id).populate({
        path: 'residentId',
        select: 'firstName middleName lastName suffix email contactNumber userId',
        populate: { path: 'userId', select: 'email username' }
    });

    if (!report) {
        throw createHttpError(404, 'Report not found');
    }

    if (!isValidTransition('report', report.status, 'resolved')) {
        throw createHttpError(400, `Cannot resolve report from status: ${report.status}`);
    }

    const previousStatus = report.status;
    report.status = 'resolved';
    await report.save();

    // Log change
    await logStatusChange('Report', report._id, previousStatus, 'resolved', req.user, '', req.ip);
    await notifyRequestStatus(report, 'report', 'resolved', '', buildReportEmailDetails(report, 'resolved'));

    res.json({ success: true, message: 'Report marked as resolved', data: report });
});

exports.rejectReport = asyncHandler(async (req, res) => {
    const { reason } = req.body;

    if (!reason?.trim()) {
        throw createHttpError(400, 'Reason for rejection is required');
    }

    const report = await Report.findById(req.params.id).populate({
        path: 'residentId',
        select: 'firstName middleName lastName suffix email contactNumber userId',
        populate: { path: 'userId', select: 'email username' }
    });

    if (!report) {
        throw createHttpError(404, 'Report not found');
    }

    if (!isValidTransition('report', report.status, 'rejected')) {
        throw createHttpError(400, `Cannot reject report with status: ${report.status}`);
    }

    const previousStatus = report.status;
    report.status = 'rejected';
    report.adminNotes = reason;
    await report.save();

    // Log change
    await logStatusChange('Report', report._id, previousStatus, 'rejected', req.user, reason, req.ip);
    await notifyRequestStatus(report, 'report', 'rejected', reason, buildReportEmailDetails(report, 'rejected'));

    res.json({ success: true, message: 'Report rejected', data: report });
});
