const DisasterAdvisory = require('../models/DisasterAdvisory');
const Resident = require('../models/Resident');
const asyncHandler = require('../utils/asyncHandler');
const { createHttpError } = require('../utils/httpError');
const { sendDisasterAdvisoryEmail } = require('../utils/mailer');
const { sendSmsNotification } = require('../utils/sms');
const { persistPublicUpload } = require('../utils/publicUploadStorage');

const ALLOWED_DISASTER_TYPES = new Set(['typhoon', 'flood', 'landslide']);

const normalizeStringList = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
    return String(value).split(',').map((entry) => entry.trim()).filter(Boolean);
};

const normalizeComparable = (value) => String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

const getResidentName = (resident) => [resident?.firstName, resident?.middleName, resident?.lastName, resident?.suffix]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ') || 'Resident';

const parseFloodProneArea = (value) => {
    const text = String(value || '')
        .trim()
        .replace(/^\d+\.\s*/, '');

    if (!text) return null;

    const [purokValue, zoneValue] = text.split(/\s*[-,]\s*/);
    const purok = String(purokValue || '').trim();
    const zone = String(zoneValue || '').trim();

    if (!purok) return null;
    return { purok, zone };
};

const findResidentsForFloodProneAreas = async (floodProneAreas = []) => {
    const parsedAreas = floodProneAreas
        .map(parseFloodProneArea)
        .filter(Boolean);

    if (!parsedAreas.length) return [];

    const puroks = [...new Set(parsedAreas.map((area) => area.purok).filter(Boolean))];
    const residents = await Resident.find({ purok: { $in: puroks } })
        .populate('userId', 'email username role isActive accountStatus')
        .lean();

    const matchesArea = (resident) => parsedAreas.some((area) => {
        const purokMatches = normalizeComparable(resident.purok) === normalizeComparable(area.purok);
        if (!purokMatches) return false;
        if (!area.zone) return true;
        return normalizeComparable(resident.zone) === normalizeComparable(area.zone);
    });

    return residents.filter((resident) => {
        const hasContact = resident.email || resident.userId?.email || resident.contactNumber;
        return hasContact && resident.userId?.role === 'resident' && resident.userId?.isActive !== false && matchesArea(resident);
    });
};

const notifyResidentsForAdvisory = async (advisory) => {
    const recipients = await findResidentsForFloodProneAreas(advisory.floodProneAreas);
    if (!recipients.length) {
        return { notifiedResidentCount: 0, notificationSentAt: null };
    }

    const details = [
        { label: 'Affected Areas', value: advisory.floodProneAreas?.join(', ') },
        { label: 'Evacuation Centers', value: advisory.evacuationCenters?.join(', ') || 'To be announced' }
    ];

    const uniqueRecipients = new Map();
    for (const resident of recipients) {
        const key = String(resident._id || resident.contactNumber || resident.email || resident.userId?.email || '');
        if (key && !uniqueRecipients.has(key)) uniqueRecipients.set(key, resident);
    }

    const notifications = [];
    for (const resident of uniqueRecipients.values()) {
        const email = String(resident.email || resident.userId?.email || '').trim().toLowerCase();
        if (email) notifications.push(sendDisasterAdvisoryEmail(email, getResidentName(resident), advisory, details));
        if (resident.contactNumber) notifications.push(sendSmsNotification({
            phoneNumber: resident.contactNumber,
            messageType: 'disaster_advisory',
            messageContent: `Brgy Irawan ALERT: ${advisory.title}. Affected: ${advisory.floodProneAreas?.join(', ') || 'See advisory'}. Evacuation: ${advisory.evacuationCenters?.join(', ') || 'TBA'}.`,
            recipientId: resident._id,
            referenceId: String(advisory._id || '')
        }));
    }
    await Promise.allSettled(notifications);

    return {
        notifiedResidentCount: uniqueRecipients.size,
        notificationSentAt: new Date()
    };
};

const normalizeDisasterType = (value) => {
    const text = String(value || '').trim().toLowerCase();
    return ALLOWED_DISASTER_TYPES.has(text) ? text : 'typhoon';
};

const normalizeStatus = (advisory) => {
    if (advisory.status === 'ended') return 'ended';
    const expected = advisory.expectedImpactDate ? new Date(advisory.expectedImpactDate) : null;
    if (!expected || Number.isNaN(expected.getTime())) return advisory.status || 'upcoming';
    const now = new Date();
    return expected <= now ? 'ongoing' : 'upcoming';
};

const mapPayload = (body, userId, options) => {
    const { partial = false } = options || {};
    const source = body || {};
    const payload = {};

    if (!partial || source.disasterType !== undefined) {
        payload.disasterType = normalizeDisasterType(source.disasterType);
    }

    if (!partial || source.expectedImpactDate !== undefined) {
        payload.expectedImpactDate = source.expectedImpactDate;
    }

    if (!partial || source.severity !== undefined) {
        payload.severity = source.severity || 'medium';
    }

    if (!partial || source.floodProneAreas !== undefined) {
        payload.floodProneAreas = normalizeStringList(source.floodProneAreas);
    }

    if (!partial || source.evacuationCenters !== undefined) {
        payload.evacuationCenters = normalizeStringList(source.evacuationCenters);
    }

    if (!partial || source.advisoryMessage !== undefined) {
        payload.advisoryMessage = String(source.advisoryMessage || '').trim();
    }

    if (!partial || source.status !== undefined) {
        payload.status = source.status;
    }

    if (source.imagePath !== undefined) {
        payload.imagePath = String(source.imagePath || '').trim();
    }

    if (!partial) {
        payload.createdBy = userId;
    }

    return payload;
};

exports.getAdminDisasterAdvisories = asyncHandler(async (_req, res) => {
    const advisories = await DisasterAdvisory.find()
        .populate('createdBy', 'username email')
        .sort({ expectedImpactDate: 1, createdAt: -1 });

    const normalized = advisories.map((advisory) => {
        const advisoryObject = advisory.toObject();
        advisoryObject.status = normalizeStatus(advisoryObject);
        return advisoryObject;
    });

    res.json(normalized);
});

exports.getPublicDisasterAdvisories = asyncHandler(async (_req, res) => {
    const advisories = await DisasterAdvisory.find({ status: { $in: ['upcoming', 'ongoing'] } })
        .sort({ expectedImpactDate: 1, createdAt: -1 })
        .lean();

    const normalized = advisories.map((advisory) => ({
        ...advisory,
        status: normalizeStatus(advisory)
    }));

    res.json(normalized.filter((advisory) => advisory.status !== 'ended'));
});

exports.createDisasterAdvisory = asyncHandler(async (req, res) => {
    const payload = mapPayload(req.body, req.user.id);
    if (req.file) {
        await persistPublicUpload(req.file);
        payload.imagePath = `/uploads/${req.file.filename}`;
    }

    if (!payload.expectedImpactDate) {
        throw createHttpError(400, 'expectedImpactDate is required', { code: 'DISASTER_ADVISORY_VALIDATION' });
    }
    if (!payload.advisoryMessage) {
        throw createHttpError(400, 'advisoryMessage is required', { code: 'DISASTER_ADVISORY_VALIDATION' });
    }

    const advisory = await DisasterAdvisory.create({
        ...payload,
        status: payload.status || 'upcoming'
    });

    const notificationResult = await notifyResidentsForAdvisory(advisory.toObject());
    advisory.notifiedResidentCount = notificationResult.notifiedResidentCount;
    if (notificationResult.notificationSentAt) {
        advisory.notificationSentAt = notificationResult.notificationSentAt;
    }
    if (notificationResult.notificationSentAt || notificationResult.notifiedResidentCount === 0) {
        await advisory.save();
    }

    const populated = await DisasterAdvisory.findById(advisory._id).populate('createdBy', 'username email');
    const response = populated.toObject();
    response.status = normalizeStatus(response);
    res.status(201).json(response);
});

exports.updateDisasterAdvisory = asyncHandler(async (req, res) => {
    const payload = mapPayload(req.body, req.user.id, { partial: true });
    if (req.file) {
        await persistPublicUpload(req.file);
        payload.imagePath = `/uploads/${req.file.filename}`;
    }

    const advisory = await DisasterAdvisory.findByIdAndUpdate(
        req.params.id,
        payload,
        { returnDocument: 'after', runValidators: true }
    ).populate('createdBy', 'username email');

    if (!advisory) {
        throw createHttpError(404, 'Disaster advisory not found', { code: 'DISASTER_ADVISORY_NOT_FOUND' });
    }

    const response = advisory.toObject();
    response.status = normalizeStatus(response);
    res.json(response);
});

exports.deleteDisasterAdvisory = asyncHandler(async (req, res) => {
    const advisory = await DisasterAdvisory.findByIdAndDelete(req.params.id);
    if (!advisory) {
        throw createHttpError(404, 'Disaster advisory not found', { code: 'DISASTER_ADVISORY_NOT_FOUND' });
    }

    res.json({ message: 'Disaster advisory deleted successfully.' });
});
