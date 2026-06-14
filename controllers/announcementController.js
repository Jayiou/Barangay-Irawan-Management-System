const fs = require('node:fs');
const path = require('node:path');
const asyncHandler = require('../utils/asyncHandler');
const { createHttpError } = require('../utils/httpError');
const { normalizePublicUploadUrl, resolvePublicUploadFilePath } = require('../utils/uploadPaths');
const { persistPublicUpload } = require('../utils/publicUploadStorage');
const Announcement = require('../models/Announcement');
const Resident = require('../models/Resident');
const { sendSmsNotification } = require('../utils/sms');

const getAnnouncementWebsiteUrl = () => String(
    process.env.PUBLIC_WEBSITE_URL
    || process.env.APP_URL
    || process.env.FRONTEND_URL
    || process.env.RENDER_EXTERNAL_URL
    || 'https://barangay-irawan-management-system.onrender.com'
).trim().replace(/\/$/, '');

const buildImportantAnnouncementMessage = (announcement) => {
    const websiteUrl = getAnnouncementWebsiteUrl();
    const detailsText = websiteUrl
        ? `Visit ${websiteUrl} for more details.`
        : 'Visit the Barangay Irawan website for more details.';

    return `Brgy Irawan IMPORTANT: ${announcement.title}. ${detailsText}`;
};

const notifyResidentsOfImportantAnnouncement = async (announcement) => {
    const residents = await Resident.find({ contactNumber: { $nin: ['', null] } })
        .populate('userId', 'role isActive accountStatus')
        .lean();
    const recipients = new Map();

    for (const resident of residents) {
        const user = resident.userId;
        const phoneNumber = String(resident.contactNumber || '').trim();
        if (
            phoneNumber
            && user?.role === 'resident'
            && user?.isActive !== false
            && user?.accountStatus === 'approved'
            && !recipients.has(phoneNumber)
        ) {
            recipients.set(phoneNumber, resident);
        }
    }

    const recipientEntries = [...recipients.entries()];
    let sentCount = 0;

    for (let index = 0; index < recipientEntries.length; index += 20) {
        const batch = recipientEntries.slice(index, index + 20);
        const results = await Promise.allSettled(batch.map(([phoneNumber, resident]) => sendSmsNotification({
            phoneNumber,
            messageType: 'important_announcement',
            messageContent: buildImportantAnnouncementMessage(announcement),
            recipientId: resident._id,
            referenceId: String(announcement._id || '')
        })));

        sentCount += results.filter((result) => result.status === 'fulfilled' && result.value?.sent).length;
    }

    return sentCount;
};

const parseAnnouncementDate = (value, fieldName, required = false) => {
    const normalized = String(value || '').trim();

    if (!normalized) {
        if (required) {
            throw createHttpError(400, `${fieldName} is required`);
        }

        return null;
    }

    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) {
        throw createHttpError(400, `Invalid ${fieldName} format`);
    }

    return date;
};

const validateAnnouncementWindow = (startDate, endDate) => {
    if (startDate && endDate && endDate < startDate) {
        throw createHttpError(400, 'End date cannot be earlier than start date');
    }
};

const getBooleanValue = (value, fallback = true) => {
    if (value === undefined) return fallback;
    return value === true || value === 'true';
};

const serializeAnnouncement = (announcement) => {
    if (!announcement) {
        return announcement;
    }

    const output = announcement.toObject ? announcement.toObject() : { ...announcement };
    const normalizedImagePath = normalizePublicUploadUrl(output.imagePath || output.imageUrl);
    const normalizedImageUrl = normalizePublicUploadUrl(output.imageUrl || output.imagePath);

    if (normalizedImagePath) {
        output.imagePath = normalizedImagePath;
    } else {
        delete output.imagePath;
    }

    if (normalizedImageUrl) {
        output.imageUrl = normalizedImageUrl;
    } else {
        delete output.imageUrl;
    }

    return output;
};

const deleteAnnouncementImageFile = (imagePath) => {
    const filename = path.basename(String(imagePath || '').trim().split('?')[0].split('#')[0]);
    if (!filename) return;

    const filePath = resolvePublicUploadFilePath(filename);
    if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
};

exports.getAnnouncements = asyncHandler(async (req, res) => {
    const now = new Date();
    const announcements = await Announcement.find({
        isActive: true,
        startDate: { $lte: now },
        $or: [
            { endDate: { $gte: now } },
            { endDate: null },
            { endDate: { $exists: false } }
        ]
    })
        .sort({ displayOrder: 1, createdAt: -1 })
        .select('-createdBy');

    res.json({
        success: true,
        data: announcements.map(serializeAnnouncement)
    });
});

exports.getAllAnnouncements = asyncHandler(async (req, res) => {
    const announcements = await Announcement.find()
        .populate('createdBy', 'username email')
        .sort({ displayOrder: 1, createdAt: -1 });

    res.json({
        success: true,
        data: announcements.map(serializeAnnouncement)
    });
});

exports.getNextDisplayOrder = asyncHandler(async (req, res) => {
    const nextOrder = await Announcement.getNextDisplayOrder();

    res.json({
        success: true,
        data: { nextDisplayOrder: nextOrder }
    });
});

exports.createAnnouncement = asyncHandler(async (req, res) => {
    const { title, description, startDate, endDate, isActive, isImportant } = req.body;

    if (!String(title || '').trim() || !String(description || '').trim()) {
        throw createHttpError(400, 'Title and description are required');
    }

    const startDateObj = parseAnnouncementDate(startDate, 'start date', true);
    const endDateObj = parseAnnouncementDate(endDate, 'end date');
    validateAnnouncementWindow(startDateObj, endDateObj);

    const announcement = new Announcement({
        title: String(title).trim(),
        description: String(description).trim(),
        displayOrder: await Announcement.getNextDisplayOrder(),
        startDate: startDateObj,
        endDate: endDateObj,
        createdBy: req.user.id,
        isActive: getBooleanValue(isActive, true),
        isImportant: getBooleanValue(isImportant, false)
    });

    if (req.file) {
        await persistPublicUpload(req.file);
        announcement.imagePath = `/uploads/${req.file.filename}`;
    }

    await announcement.save();

    if (announcement.isImportant) {
        try {
            announcement.smsNotifiedResidentCount = await notifyResidentsOfImportantAnnouncement(announcement);
            announcement.smsNotificationSentAt = new Date();
            await announcement.save();
        } catch (error) {
            console.error('Failed to notify residents about important announcement:', error);
        }
    }

    await announcement.populate('createdBy', 'username email');

    res.status(201).json({
        success: true,
        message: 'Announcement created successfully',
        data: serializeAnnouncement(announcement)
    });
});

const applyAnnouncementUpdates = async (announcement, body, file) => {
    const { title, description, displayOrder, startDate, endDate, isActive, isImportant } = body;

    if (title !== undefined && !String(title || '').trim()) {
        throw createHttpError(400, 'Title is required');
    }

    if (description !== undefined && !String(description || '').trim()) {
        throw createHttpError(400, 'Description is required');
    }

    const nextStartDate = startDate !== undefined
        ? parseAnnouncementDate(startDate, 'start date', true)
        : announcement.startDate;
    const nextEndDate = endDate !== undefined
        ? parseAnnouncementDate(endDate, 'end date')
        : announcement.endDate;

    validateAnnouncementWindow(nextStartDate, nextEndDate);

    if (title !== undefined) announcement.title = String(title).trim();
    if (description !== undefined) announcement.description = String(description).trim();
    if (displayOrder !== undefined) {
        const parsedOrder = Number.parseInt(displayOrder, 10);
        announcement.displayOrder = Number.isFinite(parsedOrder) && parsedOrder >= 1 ? parsedOrder : 1;
    }
    if (startDate !== undefined) announcement.startDate = nextStartDate;
    if (endDate !== undefined) announcement.endDate = nextEndDate;
    if (isActive !== undefined) announcement.isActive = getBooleanValue(isActive, true);
    if (isImportant !== undefined) announcement.isImportant = getBooleanValue(isImportant, false);
    if (file) {
        await persistPublicUpload(file);
        const oldImagePath = announcement.imagePath;
        announcement.imagePath = `/uploads/${file.filename}`;
        deleteAnnouncementImageFile(oldImagePath);
    }
};

exports.updateAnnouncement = asyncHandler(async (req, res) => {
    const announcement = await Announcement.findById(req.params.id);
    if (!announcement) {
        throw createHttpError(404, 'Announcement not found');
    }

    await applyAnnouncementUpdates(announcement, req.body, req.file);

    await announcement.save();
    await announcement.populate('createdBy', 'username email');

    res.json({
        success: true,
        message: 'Announcement updated successfully',
        data: serializeAnnouncement(announcement)
    });
});

exports.deleteAnnouncement = asyncHandler(async (req, res) => {
    const announcement = await Announcement.findByIdAndDelete(req.params.id);
    if (!announcement) {
        throw createHttpError(404, 'Announcement not found');
    }

    deleteAnnouncementImageFile(announcement.imagePath);

    res.json({
        success: true,
        message: 'Announcement deleted successfully'
    });
});

exports.updateDisplayOrder = asyncHandler(async (req, res) => {
    const { announcements } = req.body;

    if (!Array.isArray(announcements)) {
        throw createHttpError(400, 'Announcements array is required');
    }

    for (const item of announcements) {
        await Announcement.findByIdAndUpdate(item.id, { displayOrder: item.displayOrder ?? item.order });
    }

    res.json({
        success: true,
        message: 'Display order updated successfully'
    });
});
