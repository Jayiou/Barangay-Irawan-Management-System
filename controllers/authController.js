const User = require('../models/User');
const Resident = require('../models/Resident');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const asyncHandler = require('../utils/asyncHandler');
const { createHttpError } = require('../utils/httpError');
const mailer = require('../utils/mailer');
const { sendOtpSMS } = require('../utils/sms');
const s3 = require('../utils/s3');

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const MINIMUM_AGE = 18;
const MAXIMUM_AGE = 120;
const OTP_EXPIRY_MINUTES = 10;
const PASSWORD_RESET_EXPIRY_MINUTES = 30;
const GENERIC_LOGIN_ERROR = 'Invalid username or password';
const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[_|@$!%*?&])[A-Za-z\d_|@$!%*?&]{8,}$/;
const BARANGAY_ADDRESS = 'Barangay Irawan';
const ALLOWED_PUROKS = ['Magsasaka', 'Sampalok', 'Masagana', 'Acacia', 'Freedom', 'Visapa'];
const PUROK_ZONE_MAP = {
    Sampalok: ['Zone 1', 'Zone 2', 'Zone 3', 'Zone 4'],
    Acacia: Array.from({ length: 10 }, (_, index) => `Zone ${index + 5}`)
};

const calculateAge = (birthDateString) => {
    const today = new Date();
    const birthDate = new Date(birthDateString);
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    return age;
};

const signToken = (user) => jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
);

const isValidEmail = (email) => emailRegex.test(String(email).trim());

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const generateOtp = () => crypto.randomInt(100000, 999999).toString();

const generateResetToken = () => crypto.randomBytes(32).toString('hex');

const hashResetToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const hashEmailChangeToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const toBoolean = (value) => {
    if (typeof value === 'boolean') return value;
    return String(value).toLowerCase() === 'true';
};

const normalizeContactNumber = (value) => {
    const rawValue = String(value || '').trim().replace(/\s|-/g, '');
    if (/^09\d{9}$/.test(rawValue)) return rawValue;
    if (/^\+639\d{9}$/.test(rawValue)) return `0${rawValue.slice(3)}`;
    if (/^639\d{9}$/.test(rawValue)) return `0${rawValue.slice(2)}`;
    return '';
};

const normalizeZone = (value) => {
    const text = String(value || '').trim();
    if (!text) return '';
    const match = text.match(/\d+/);
    return match ? `Zone ${Number(match[0])}` : text;
};

const validatePurokZone = (purok, zone) => {
    const normalizedPurok = String(purok || '').trim();
    const normalizedZone = normalizeZone(zone);
    const allowedZones = PUROK_ZONE_MAP[normalizedPurok] || [];

    if (!ALLOWED_PUROKS.includes(normalizedPurok)) {
        return { message: 'Please select a valid Purok.', normalizedPurok, normalizedZone };
    }

    if (allowedZones.length && !allowedZones.includes(normalizedZone)) {
        return { message: `${normalizedPurok} requires a valid zone selection.`, normalizedPurok, normalizedZone };
    }

    if (!allowedZones.length && normalizedZone) {
        return { message: `${normalizedPurok} does not have zone options.`, normalizedPurok, normalizedZone: '' };
    }

    return { message: '', normalizedPurok, normalizedZone };
};

const getAppOrigin = (req) => {
    const bodyOrigin = String(req.body?.appUrl || '').trim().replace(/\/$/, '');
    if (bodyOrigin) {
        return bodyOrigin;
    }

    const configuredOrigin = String(process.env.APP_URL || process.env.FRONTEND_URL || '').trim().replace(/\/$/, '');
    if (configuredOrigin) {
        return configuredOrigin;
    }

    const requestOrigin = String(req.headers.origin || '').trim().replace(/\/$/, '');
    if (requestOrigin) {
        return requestOrigin;
    }

    const host = req?.get?.('host') || req?.headers?.host || 'localhost:5000';
    const protocol = req?.protocol || 'http';
    return `${protocol}://${host}`.replace(/\/$/, '');
};

const getSafeRedirectPath = (pathValue) => {
    const rawPath = String(pathValue || '').trim();
    if (!rawPath) return '/';
    if (!rawPath.startsWith('/')) return '/';
    if (rawPath.startsWith('//')) return '/';
    return rawPath.replace(/\/$/, '') || '/';
};

const createOtpExpiry = () => new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
const createEmailChangeExpiry = () => new Date(Date.now() + PASSWORD_RESET_EXPIRY_MINUTES * 60 * 1000);

const hashOtp = (otpCode) => bcrypt.hash(otpCode, 10);

const generateEmailChangeToken = () => crypto.randomBytes(32).toString('hex');

const compareOtp = (otpCode, otpHash) => {
    if (!otpHash) {
        return false;
    }

    if (!String(otpHash).startsWith('$2')) {
        return String(otpCode) === String(otpHash);
    }

    return bcrypt.compare(otpCode, otpHash);
};

const verifyRecaptcha = async (token) => {
    // Only skip reCaptcha if explicitly enabled for testing/development
    if (process.env.SKIP_RECAPTCHA === 'true') {
        console.log('[SECURITY] Skipping reCaptcha verification (SKIP_RECAPTCHA is true)');
        return { success: true };
    }

    if (!token) {
        throw createHttpError(400, 'reCaptcha verification is required.', { code: 'RECAPTCHA_REQUIRED' });
    }

    if (!process.env.RECAPTCHA_SECRET_KEY) {
        console.error('RECAPTCHA_SECRET_KEY is not configured in production.');
        throw createHttpError(500, 'reCaptcha verification is not configured.', { code: 'RECAPTCHA_NOT_CONFIGURED' });
    }

    try {
        const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                secret: process.env.RECAPTCHA_SECRET_KEY,
                response: token
            })
        });

        const data = await response.json();

        if (!data.success) {
            throw createHttpError(400, 'reCaptcha verification failed. Please verify the checkbox and try again.', { code: 'RECAPTCHA_FAILED' });
        }

        // reCaptcha v2 returns success boolean (no score)
        return data;
    } catch (error) {
        if (error.code === 'RECAPTCHA_FAILED') {
            throw error;
        }
        console.error('reCaptcha verification error:', error);
        throw createHttpError(500, 'reCaptcha verification service unavailable.', { code: 'RECAPTCHA_ERROR' });
    }
};

const persistProofOfResidency = async (file) => {
    if (!file?.filename) {
        return '';
    }

    if (!s3.isConfigured()) {
        return file.filename;
    }

    if (!file.path) {
        throw createHttpError(500, 'Proof of residency file could not be prepared for storage.', { code: 'PROOF_STORAGE_ERROR' });
    }

    const key = `proofs/${path.basename(file.filename)}`;
    const buffer = await fs.readFile(file.path);
    await s3.uploadBuffer(key, buffer, file.mimetype || 'application/octet-stream');
    return key;
};

// REGISTER
exports.register = asyncHandler(async (req, res) => {
    // 1. Separate user core fields from resident details
    const { 
        username, email, password, role,
        firstName, middleName, lastName, suffix, sex, birthDate, civilStatus, contactNumber, address, purok, zone, houseNumber, streetAddress, citizenship, occupation, voterStatus, recaptchaToken,
        householdMemberCount, householdId, medicalConditions, floodProneArea, evacuationPriority
    } = req.body;

    const proofOfResidencyFile = req.files?.proofOfResidency?.[0] || req.file || null;
    let proofOfResidency = proofOfResidencyFile?.filename || null;
    const normalizedContactNumber = normalizeContactNumber(contactNumber);
    const { message: purokZoneError, normalizedPurok, normalizedZone } = validatePurokZone(purok, zone);

    // 1.5. Verify reCaptcha token
    await verifyRecaptcha(recaptchaToken);

    // 2. Validate essential inputs
    const missingFields = {};
    if (!username) missingFields.username = 'Username is required.';
    if (!email) missingFields.email = 'Email address is required.';
    if (!password) missingFields.password = 'Password is required.';
    if (!firstName) missingFields.firstName = 'First name is required.';
    if (!lastName) missingFields.lastName = 'Last name is required.';
    if (!sex) missingFields.sex = 'Gender is required.';
    if (!birthDate) missingFields.birthDate = 'Birth date is required.';
    if (!contactNumber) missingFields.contactNumber = 'Contact number is required.';
    if (!normalizedPurok) missingFields.purok = 'Purok is required.';
    if (Object.keys(missingFields).length) {
        throw createHttpError(400, 'Please complete the required registration fields.', { code: 'AUTH_VALIDATION_ERROR', fields: missingFields });
    }

    if (!normalizedContactNumber) {
        throw createHttpError(400, 'Contact number must be a valid PH number: 09XXXXXXXXX or +639XXXXXXXXX.', { code: 'AUTH_VALIDATION_ERROR', fields: { contactNumber: 'Enter a valid PH number: 09XXXXXXXXX or +639XXXXXXXXX.' } });
    }

    if (purokZoneError) {
        throw createHttpError(400, purokZoneError, { code: 'AUTH_VALIDATION_ERROR', fields: { zone: purokZoneError } });
    }

    if (!isValidEmail(email)) {
        throw createHttpError(400, 'Please provide a valid email address.', { code: 'AUTH_VALIDATION_ERROR', fields: { email: 'Please provide a valid email address.' } });
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
        throw createHttpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`, { code: 'AUTH_VALIDATION_ERROR', fields: { password: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.` } });
    }

    if (!STRONG_PASSWORD_REGEX.test(password)) {
        throw createHttpError(400, 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (e.g. underscore _).', { code: 'AUTH_VALIDATION_ERROR', fields: { password: 'Add an uppercase letter, lowercase letter, number, and special character.' } });
    }

    // 3. Age validation
    const age = calculateAge(birthDate);
    if (age < MINIMUM_AGE) {
        throw createHttpError(403, `You must be at least ${MINIMUM_AGE} years old to register unassisted.`, { code: 'AGE_RESTRICTION', fields: { birthDate: `Registrant must be at least ${MINIMUM_AGE} years old.` } });
    }
    if (age > MAXIMUM_AGE) {
        throw createHttpError(400, `Please enter a realistic birth date. Maximum supported age is ${MAXIMUM_AGE}.`, { code: 'AGE_RESTRICTION', fields: { birthDate: `Age cannot exceed ${MAXIMUM_AGE} years.` } });
    }

    // 4. Check for attached file
    if (!proofOfResidency) {
        throw createHttpError(400, 'Proof of residency (ID or Document) picture is required.', { code: 'MISSING_FILE', fields: { proofOfResidency: 'Proof of residency is required.' } });
    }

    // 5. Existing user check
    const normalizedEmail = normalizeEmail(email);
    const existingUsername = await User.findOne({ username });
    if (existingUsername) {
        if (existingUsername.accountStatus === 'pending_otp') {
            throw createHttpError(409, 'Username already exists but is pending OTP verification. Please check your email or request a new OTP.', { code: 'AUTH_CONFLICT_UNVERIFIED', fields: { username: 'This username is already pending OTP verification.' } });
        }
        throw createHttpError(409, 'Username already exists. Please choose another username.', { code: 'AUTH_CONFLICT', fields: { username: 'This username is already taken.' } });
    }
    const existingEmail = await User.findOne({ email: normalizedEmail });
    if (existingEmail) {
        if (existingEmail.accountStatus === 'pending_otp') {
            throw createHttpError(409, 'Email already exists but is pending OTP verification. Please check your email or request a new OTP.', { code: 'AUTH_CONFLICT_UNVERIFIED', fields: { email: 'This email is already pending OTP verification.' } });
        }
        throw createHttpError(409, 'Email already exists. Please use another email address.', { code: 'AUTH_CONFLICT', fields: { email: 'This email address is already registered.' } });
    }

    proofOfResidency = await persistProofOfResidency(proofOfResidencyFile);

    // 6. OTP generation
    const otpCode = generateOtp();
    const otpHash = await hashOtp(otpCode);
    const otpExpires = createOtpExpiry();

    const hashedPassword = await bcrypt.hash(password, 10);
    const hasAdmin = await User.exists({ role: 'admin' });
    const assignedRole = (!hasAdmin && role === 'admin') ? 'admin' : 'resident';

    // 7. Save user and cache resident profile until OTP verification succeeds
    const user = await User.create({
        username,
        email: normalizedEmail,
        password: hashedPassword,
        role: assignedRole,
        accountStatus: 'pending_otp',
        otpCode: otpHash,
        otpExpires,
        pendingResidentProfile: {
            firstName,
            middleName: middleName || '',
            lastName,
            suffix: suffix || '',
            sex,
            birthDate,
            civilStatus: civilStatus || 'single',
            contactNumber: normalizedContactNumber,
            address: BARANGAY_ADDRESS,
            purok: normalizedPurok,
            zone: normalizedZone,
            houseNumber: houseNumber || '',
            streetAddress: streetAddress || '',
            citizenship: citizenship || 'Filipino',
            occupation: occupation || '',
            voterStatus: voterStatus || 'not_registered',
            householdMemberCount: Number(householdMemberCount) || 1,
            householdId: householdId || '',
            medicalConditions: medicalConditions || '',
            floodProneArea: toBoolean(floodProneArea),
            evacuationPriority: evacuationPriority || '',
            proofOfResidency
        },
        isActive: false // Explicitly inactive until OTP -> Admin Approval
    });

    // 8. Send Email (Do not await so UI doesn't hang on server timeouts)
    mailer.sendOtpEmail(normalizedEmail, otpCode, firstName).catch(e => console.error("Email send failed in background:", e));
    sendOtpSMS(normalizedContactNumber, otpCode).catch(e => console.error("SMS send failed in background:", e));
    
    // FOR RENDER DEPLOYMENTS: Since free Render blocks SMTP emails, log it here so you can test it
    console.log(`\n==============================================`);
    console.log(`🔑 OTP CODE FOR ${normalizedEmail}: ${otpCode}`);
    console.log(`==============================================\n`);

    res.status(201).json({
        message: 'Registration initiated. Please check your email for the OTP. If you do not see it in your inbox, please check your Spam folder.',
        user: { id: user._id, email: user.email }
    });
});

// VERIFY OTP
exports.verifyOtp = asyncHandler(async (req, res) => {
    const { email, otpCode } = req.body;
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !otpCode) {
        throw createHttpError(400, 'Email and OTP code are required.', { code: 'OTP_MISSING' });
    }

    const user = await User.findOne({ email: normalizedEmail, accountStatus: 'pending_otp' });

    if (!user) {
        throw createHttpError(404, 'User not found or already verified.', { code: 'OTP_USER_NOT_FOUND' });
    }

    if (new Date() > user.otpExpires) {
        throw createHttpError(400, 'OTP code has expired. Please request a new one.', { code: 'OTP_EXPIRED' });
    }

    const isOtpMatch = await compareOtp(String(otpCode), user.otpCode || '');

    if (!isOtpMatch) {
        throw createHttpError(400, 'Invalid OTP code.', { code: 'OTP_INVALID' });
    }

    // Update status 
    const existingResident = await Resident.findOne({ userId: user._id });
    if (!existingResident) {
        const pendingProfile = user.pendingResidentProfile || {};

        if (pendingProfile.firstName && pendingProfile.lastName && pendingProfile.sex && pendingProfile.birthDate && pendingProfile.address) {
            await Resident.create({
                userId: user._id,
                firstName: pendingProfile.firstName,
                middleName: pendingProfile.middleName || '',
                lastName: pendingProfile.lastName,
                suffix: pendingProfile.suffix || '',
                sex: pendingProfile.sex,
                birthDate: pendingProfile.birthDate,
                civilStatus: pendingProfile.civilStatus || 'single',
                contactNumber: pendingProfile.contactNumber || '',
                address: pendingProfile.address || BARANGAY_ADDRESS,
                purok: pendingProfile.purok || '',
                zone: pendingProfile.zone || '',
                houseNumber: pendingProfile.houseNumber || '',
                streetAddress: pendingProfile.streetAddress || '',
                citizenship: pendingProfile.citizenship || 'Filipino',
                occupation: pendingProfile.occupation || '',
                voterStatus: pendingProfile.voterStatus || 'not_registered',
                householdMemberCount: Number(pendingProfile.householdMemberCount) || 1,
                householdId: pendingProfile.householdId || '',
                medicalConditions: pendingProfile.medicalConditions || '',
                floodProneArea: Boolean(pendingProfile.floodProneArea),
                evacuationPriority: pendingProfile.evacuationPriority || '',
                proofOfResidency: pendingProfile.proofOfResidency || ''
            });
        }
    }

    user.accountStatus = 'pending_approval';
    user.otpCode = undefined;
    user.otpExpires = undefined;
    user.pendingResidentProfile = undefined;
    await user.save();

    res.json({
        message: 'Email successfully verified! Your account is now pending admin approval.'
    });
});

exports.resendOtp = asyncHandler(async (req, res) => {
    const normalizedEmail = normalizeEmail(req.body?.email);

    if (!normalizedEmail) {
        throw createHttpError(400, 'Email is required.', { code: 'OTP_MISSING_EMAIL' });
    }

    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
        throw createHttpError(404, 'Email not found in our records.', { code: 'USER_NOT_FOUND' });
    }

    if (user.accountStatus !== 'pending_otp') {
        throw createHttpError(400, 'Account is already verified or no longer requires OTP.', { code: 'OTP_NOT_REQUIRED' });
    }

    const otpCode = generateOtp();
    user.otpCode = await hashOtp(otpCode);
    user.otpExpires = createOtpExpiry();
    await user.save();
    const pendingContactNumber = user.pendingResidentProfile?.contactNumber || '';
    await Promise.allSettled([
        mailer.sendOtpEmail(user.email, otpCode, user.username),
        pendingContactNumber ? sendOtpSMS(pendingContactNumber, otpCode) : Promise.resolve()
    ]);

    // FOR TESTING/RENDER: Log terminal check
    console.log(`\n==============================================`);
    console.log(`🔑 RESENT OTP CODE FOR ${normalizedEmail}: ${otpCode}`);
    console.log(`==============================================\n`);

    res.json({
        message: 'A new OTP has been successfully sent to your email. If you do not see it in your inbox, please check your Spam folder.'
    });
});

exports.forgotPassword = asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);

    if (!email) {
        throw createHttpError(400, 'Email is required.', { code: 'PASSWORD_RESET_EMAIL_REQUIRED' });
    }

    const user = await User.findOne({ email });

    if (user) {
        const resetToken = generateResetToken();
        user.passwordResetToken = hashResetToken(resetToken);
        user.passwordResetExpires = new Date(Date.now() + PASSWORD_RESET_EXPIRY_MINUTES * 60 * 1000);
        await user.save();

        try {
            const appOrigin = getAppOrigin(req);
            const redirectPath = getSafeRedirectPath(req.body?.redirectPath);
            const redirectMode = String(req.body?.redirect || 'reset-password').trim() || 'reset-password';
            const resetLink = `${appOrigin}${redirectPath}?resetToken=${encodeURIComponent(resetToken)}&email=${encodeURIComponent(email)}&redirect=${encodeURIComponent(redirectMode)}`;
            await mailer.sendPasswordResetEmail(user.email, user.username, resetLink);
        } catch (mailError) {
            console.error('Password reset email could not be sent:', mailError);
        }
    }

    res.json({
        message: 'If the request is valid, a password reset link has been sent.'
    });
});

exports.resetPassword = asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const { resetToken, password, confirmPassword } = req.body;

    if (!email || !resetToken || !password || !confirmPassword) {
        throw createHttpError(400, 'Email, reset token, and new password are required.', { code: 'PASSWORD_RESET_VALIDATION_ERROR' });
    }

    if (password !== confirmPassword) {
        throw createHttpError(400, 'Passwords do not match.', { code: 'PASSWORD_RESET_VALIDATION_ERROR' });
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
        throw createHttpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`, { code: 'PASSWORD_RESET_VALIDATION_ERROR' });
    }

    if (!STRONG_PASSWORD_REGEX.test(password)) {
        throw createHttpError(400, 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (e.g. underscore _).', { code: 'PASSWORD_RESET_VALIDATION_ERROR' });
    }

    const hashedResetToken = hashResetToken(String(resetToken));
    const user = await User.findOne({
        email,
        passwordResetToken: hashedResetToken,
        passwordResetExpires: { $gt: new Date() }
    });

    if (!user) {
        throw createHttpError(400, 'Password reset link is invalid or expired.', { code: 'PASSWORD_RESET_INVALID' });
    }

    user.password = await bcrypt.hash(password, 10);
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.failedLoginAttempts = 0;
    user.lastFailedLoginAt = null;
    user.lockedUntil = null;
    await user.save();

    res.json({
        message: 'Password reset successful. You can now log in with your new password.'
    });
});

exports.changePassword = asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!userId || !currentPassword || !newPassword || !confirmPassword) {
        throw createHttpError(400, 'Current password, new password, and confirmation are required.', { code: 'PASSWORD_CHANGE_VALIDATION_ERROR' });
    }

    if (newPassword !== confirmPassword) {
        throw createHttpError(400, 'Passwords do not match.', { code: 'PASSWORD_CHANGE_VALIDATION_ERROR' });
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
        throw createHttpError(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`, { code: 'PASSWORD_CHANGE_VALIDATION_ERROR' });
    }

    if (!STRONG_PASSWORD_REGEX.test(newPassword)) {
        throw createHttpError(400, 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (e.g. underscore _).', { code: 'PASSWORD_CHANGE_VALIDATION_ERROR' });
    }

    const user = await User.findById(userId);

    if (!user) {
        throw createHttpError(404, 'User not found', { code: 'AUTH_NOT_FOUND' });
    }

    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);

    if (!isCurrentPasswordValid) {
        throw createHttpError(400, 'Current password is incorrect.', { code: 'PASSWORD_CHANGE_INVALID_CURRENT_PASSWORD' });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.failedLoginAttempts = 0;
    user.lastFailedLoginAt = null;
    user.lockedUntil = null;
    await user.save();

    res.json({
        message: 'Password updated successfully.'
    });
});

exports.deleteAccount = asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    const currentPassword = String(req.body?.currentPassword || '').trim();

    if (!userId || !currentPassword) {
        throw createHttpError(400, 'Current password is required.', { code: 'ACCOUNT_DELETE_VALIDATION_ERROR' });
    }

    const user = await User.findById(userId);

    if (!user) {
        throw createHttpError(404, 'User not found', { code: 'AUTH_NOT_FOUND' });
    }

    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);

    if (!isCurrentPasswordValid) {
        throw createHttpError(400, 'Current password is incorrect.', { code: 'ACCOUNT_DELETE_INVALID_CURRENT_PASSWORD' });
    }

    if (user.role === 'resident') {
        const resident = await Resident.findOne({ userId: user._id });
        if (resident) {
            await resident.deleteOne();
        }
    }

    await user.deleteOne();

    res.json({
        message: 'Your account has been deleted successfully.'
    });
});

// LOGIN
exports.login = asyncHandler(async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        throw createHttpError(400, 'Username and password are required', { code: 'AUTH_VALIDATION_ERROR' });
    }

    // Allow login with either username or email
    const user = await User.findOne({
        $or: [{ username }, { email: normalizeEmail(username) }]
    });

    // Account lockout check
    if (user?.lockedUntil && Date.now() < user.lockedUntil.getTime()) {
        const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
        throw createHttpError(429, `Account temporarily locked. Try again in ${minutesLeft} minutes.`, { 
            code: 'AUTH_ACCOUNT_LOCKED',
            lockedUntil: user.lockedUntil
        });
    }

    // Unlock account if lockout period expired
    if (user?.lockedUntil && Date.now() >= user.lockedUntil.getTime()) {
        user.lockedUntil = null;
        user.failedLoginAttempts = 0;
        await user.save();
    }

    if (!user) {
        throw createHttpError(401, GENERIC_LOGIN_ERROR, { code: 'AUTH_INVALID_CREDENTIALS' });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
        // Increment failed login attempts
        user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
        user.lastFailedLoginAt = new Date();

        // Lock account after 5 failed attempts
        if (user.failedLoginAttempts >= 5) {
            user.lockedUntil = new Date(Date.now() + 30 * 60 * 1000); // Lock for 30 minutes
            await user.save();
            throw createHttpError(429, 'Account locked due to too many failed login attempts. Try again in 30 minutes.', { 
                code: 'AUTH_ACCOUNT_LOCKED',
                lockedUntil: user.lockedUntil
            });
        }

        await user.save();
        throw createHttpError(401, GENERIC_LOGIN_ERROR, { code: 'AUTH_INVALID_CREDENTIALS' });
    }

    if (user.accountStatus === 'pending_otp') {
        throw createHttpError(403, 'Your account is almost ready. Please verify your email first, then wait for admin approval before logging in.', {
            code: 'AUTH_UNAVAILABLE'
        });
    }

    if (user.accountStatus === 'pending_approval') {
        throw createHttpError(403, 'Your registration has been received, but it is still waiting for admin approval. Please wait for the approval email before logging in.', {
            code: 'AUTH_UNAVAILABLE'
        });
    }

    if (user.accountStatus !== 'approved' || !user.isActive) {
        throw createHttpError(403, 'Your account is not available for login right now. Please contact the barangay office for assistance.', {
            code: 'AUTH_UNAVAILABLE'
        });
    }

    // Successful login - reset failed attempts
    user.failedLoginAttempts = 0;
    user.lastFailedLoginAt = null;
    user.lockedUntil = null;
    await user.save();

    const token = signToken(user);

    res.json({
        message: 'Login successful',
        token,
        user: {
            id: user._id,
            username: user.username,
            email: user.email,
            role: user.role,
            isActive: user.isActive
        }
    });
});

exports.getMe = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id).select('-password');

    if (!user) {
        throw createHttpError(404, 'User not found', { code: 'AUTH_NOT_FOUND' });
    }

    res.json(user);
});

exports.requestAdminEmailChange = asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    const currentPassword = String(req.body?.currentPassword || '').trim();
    const newEmail = normalizeEmail(req.body?.newEmail);

    if (!userId || !currentPassword || !newEmail) {
        throw createHttpError(400, 'Current password and new email are required.', { code: 'EMAIL_CHANGE_VALIDATION_ERROR' });
    }

    if (!isValidEmail(newEmail)) {
        throw createHttpError(400, 'Please provide a valid email address.', { code: 'EMAIL_CHANGE_VALIDATION_ERROR' });
    }

    const user = await User.findById(userId);
    if (!user || !['admin', 'resident', 'bhw'].includes(user.role)) {
        throw createHttpError(403, 'Access denied', { code: 'AUTH_FORBIDDEN' });
    }

    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
        throw createHttpError(400, 'Current password is incorrect.', { code: 'PASSWORD_CHANGE_INVALID_CURRENT_PASSWORD' });
    }

    if (normalizeEmail(user.email) === newEmail) {
        throw createHttpError(400, 'The new email must be different from the current email.', { code: 'EMAIL_CHANGE_NOOP' });
    }

    const existingUser = await User.findOne({ email: newEmail, _id: { $ne: user._id } });
    if (existingUser) {
        throw createHttpError(409, 'That email is already in use.', { code: 'EMAIL_CHANGE_CONFLICT' });
    }

    const emailChangeToken = generateEmailChangeToken();
    user.pendingEmail = newEmail;
    user.emailChangeToken = hashEmailChangeToken(emailChangeToken);
    user.emailChangeExpires = createEmailChangeExpiry();
    await user.save();

    try {
        const defaultRedirectPath = ['admin', 'bhw'].includes(user.role) ? '/admin' : '/portal';
        const confirmationLink = `${getAppOrigin(req)}${getSafeRedirectPath(req.body?.redirectPath || defaultRedirectPath)}?emailChangeToken=${encodeURIComponent(emailChangeToken)}&email=${encodeURIComponent(newEmail)}&redirect=email-change`;
        await mailer.sendAdminEmailChangeVerificationEmail(newEmail, user.username, confirmationLink);
    } catch (mailError) {
        console.error('Admin email change verification email could not be sent:', mailError);
    }

    res.json({
        message: 'A confirmation link has been sent to the new email address.',
        pendingEmail: newEmail
    });
});

exports.confirmAdminEmailChange = asyncHandler(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const emailChangeToken = String(req.body?.emailChangeToken || '').trim();

    if (!email || !emailChangeToken) {
        throw createHttpError(400, 'Email and confirmation token are required.', { code: 'ADMIN_EMAIL_CONFIRMATION_VALIDATION_ERROR' });
    }

    const hashedToken = hashEmailChangeToken(emailChangeToken);
    const user = await User.findOne({
        pendingEmail: email,
        emailChangeToken: hashedToken,
        emailChangeExpires: { $gt: new Date() },
    });

    if (!user) {
        throw createHttpError(400, 'Email confirmation link is invalid or expired.', { code: 'ADMIN_EMAIL_CONFIRMATION_INVALID' });
    }

    user.email = email;
    user.pendingEmail = undefined;
    user.emailChangeToken = undefined;
    user.emailChangeExpires = undefined;
    await user.save();

    if (user.role === 'resident') {
        await Resident.findOneAndUpdate({ userId: user._id }, { email });
    }

    res.json({
        message: user.role === 'admin' ? 'Admin email updated successfully.' : 'Email updated successfully.',
        user: {
            id: user._id,
            username: user.username,
            email: user.email,
            role: user.role,
            isActive: user.isActive
        }
    });
});
