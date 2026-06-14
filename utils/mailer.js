const fs = require('node:fs');
const nodemailer = require('nodemailer');

const formatLabel = (text) => {
    if (!text) return text;
    return text
        .replaceAll('_', ' ')   
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
};

const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const normalizeDetailItems = (details = []) => {
    const entries = Array.isArray(details)
        ? details
        : Object.entries(details).map(([label, value]) => ({ label, value }));

    return entries
        .map((detail) => {
            const label = Array.isArray(detail) ? detail[0] : detail.label;
            const value = Array.isArray(detail) ? detail[1] : detail.value;
            return {
                label: String(label || '').trim(),
                value: String(value ?? '').trim()
            };
        })
        .filter((detail) => detail.label && detail.value);
};

const buildDetailsText = (details, heading = 'Request Details') => {
    const items = normalizeDetailItems(details);
    if (!items.length) return '';

    let output = `${heading}:\n`;
    for (const item of items) {
        output += '- ' + item.label + ': ' + item.value + '\n';
    }
    return output;
};

const buildDetailsHtml = (details, heading = 'Request Details') => {
    const items = normalizeDetailItems(details);
    if (!items.length) return '';

    return `
        <div style="margin-top: 16px; padding: 12px; background: #ffffff; border: 1px solid #e0e0e0; border-radius: 6px;">
            <p style="margin: 0 0 8px 0; font-weight: bold; color: #235b82;">${escapeHtml(heading)}</p>
            <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                <tbody>
                    ${items.map((item) => `
                        <tr>
                            <td style="padding: 6px 8px 6px 0; color: #555; font-weight: bold; vertical-align: top; width: 38%;">${escapeHtml(item.label)}</td>
                            <td style="padding: 6px 0; color: #222; vertical-align: top;">${escapeHtml(item.value)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
};

const FROM_NAME = 'Barangay Irawan';
const DEFAULT_FROM_EMAIL = 'princejaydelapenaz@gmail.com';
const DEFAULT_REPLY_TO = 'princejaydelapenaz@gmail.com';
const path = require('node:path');
const https = require('node:https');

const parseFromAddress = (value) => {
    const rawValue = String(value || '').trim();
    if (!rawValue) {
        return { name: FROM_NAME, email: DEFAULT_FROM_EMAIL };
    }

    const match = /^(.+?)<([^<>\s]+@[^<>\s]+)>$/.exec(rawValue);
    if (match) {
        return {
            name: match[1].trim().replace(/\s+$/g, '') || FROM_NAME,
            email: match[2].trim()
        };
    }

    return {
        name: FROM_NAME,
        email: rawValue
    };
};

const configuredFrom = parseFromAddress(process.env.EMAIL_FROM);
const FROM_EMAIL = configuredFrom.email || DEFAULT_FROM_EMAIL;
const EMAIL_REPLY_TO = process.env.EMAIL_REPLY_TO || configuredFrom.email || DEFAULT_REPLY_TO;

const hasValidFromDomain = !FROM_EMAIL.endsWith('.local') && !FROM_EMAIL.endsWith('.localhost');
if (process.env.BREVO_API_KEY && !hasValidFromDomain) {
    console.warn('Warning: BREVO_API_KEY is configured but EMAIL_FROM is not set to a real verified sender address. Set EMAIL_FROM to a valid, verified domain to improve deliverability.');
}

// Build transporter dynamically: prefer SMTP when Brevo/other SMTP credentials are configured.
const smtpHost = process.env.EMAIL_HOST || 'smtp.sendgrid.net';
const smtpPort = process.env.EMAIL_PORT ? Number(process.env.EMAIL_PORT) : 587;
const smtpSecure = smtpPort === 465;
const hasSmtpCredentials = Boolean(process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS);
const hasBrevoApi = Boolean(process.env.BREVO_API_KEY);
const isEmailMockEnabled = () => String(process.env.EMAIL_MOCK || '').toLowerCase() === 'true';
const isEmailConfigured = () => hasSmtpCredentials || hasBrevoApi;
const shouldSkipEmailSend = () => !isEmailMockEnabled() && !isEmailConfigured();

let smtpAuth = null;
if (hasSmtpCredentials) {
    smtpAuth = { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS };
}

const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    requireTLS: true,
    auth: smtpAuth
});

const resolveAttachmentPath = (value) => {
    const rawPath = String(value || '').trim();
    if (!rawPath) return rawPath;

    if (path.isAbsolute(rawPath) && fs.existsSync(rawPath)) {
        return rawPath;
    }

    const normalized = rawPath.replace(/^\/+/, '').replace(/^public[\\/]/i, '');
    const candidates = [
        path.join(process.cwd(), normalized),
        path.join(process.cwd(), 'public', normalized),
        path.join(process.cwd(), 'public', 'uploads', path.basename(normalized))
    ];

    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return rawPath;
};

const normalizeBrevoRecipients = (value) => {
    const recipients = [];

    if (Array.isArray(value)) {
        for (const item of value) {
            if (typeof item === 'string') {
                recipients.push({ email: item });
            } else if (item?.email) {
                recipients.push({ email: item.email, name: item.name });
            }
        }

        return recipients;
    }

    if (typeof value === 'string') {
        recipients.push({ email: value });
        return recipients;
    }

    if (value?.email) {
        recipients.push({ email: value.email, name: value.name });
    }

    return recipients;
};

const normalizeBrevoSender = (value) => {
    if (value?.email) {
        return { name: value.name, email: value.email };
    }

    return { name: FROM_NAME, email: FROM_EMAIL };
};

const normalizeBrevoReplyTo = (value) => {
    if (!value) return undefined;
    if (typeof value === 'string') return { email: value };

    if (value?.email) {
        return { email: value.email, name: value.name };
    }

    return undefined;
};

const normalizeBrevoAttachments = (attachments = []) => {
    return attachments.map((attachment) => {
        if (attachment.content) {
            const contentBuffer = typeof attachment.content === 'string' ? Buffer.from(attachment.content, 'base64') : Buffer.from(attachment.content);
            return {
                name: attachment.filename || (attachment.path ? attachment.path.split(/[\\/]/).pop() : 'attachment'),
                content: contentBuffer.toString('base64')
            };
        }

        if (attachment.path) {
            const attachmentPath = resolveAttachmentPath(attachment.path);
            const fileData = fs.readFileSync(attachmentPath);
            return {
                name: attachment.filename || attachmentPath.split(/[\\/]/).pop(),
                content: fileData.toString('base64')
            };
        }

        return {
            name: attachment.filename || 'attachment',
            content: Buffer.from(String(attachment)).toString('base64')
        };
    });
};

const sendViaBrevo = (mailOptions) => {
    const toList = normalizeBrevoRecipients(mailOptions.to);
    const sender = normalizeBrevoSender(mailOptions.from);
    const replyTo = normalizeBrevoReplyTo(mailOptions.replyTo);

    const payload = {
        sender,
        to: toList,
        subject: mailOptions.subject,
        htmlContent: mailOptions.html,
        textContent: mailOptions.text,
        headers: mailOptions.headers
    };

    if (replyTo) payload.replyTo = replyTo;
    if (mailOptions.attachments) payload.attachment = normalizeBrevoAttachments(mailOptions.attachments);

    const data = JSON.stringify(payload);
    const options = {
        hostname: 'api.brevo.com',
        path: '/v3/smtp/email',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
            'api-key': process.env.BREVO_API_KEY
        }
    };

    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(body ? JSON.parse(body) : {}); } catch (e) { resolve(body); }
                } else {
                    reject(new Error(`Brevo API error ${res.statusCode}: ${body}`));
                }
            });
        });

        req.on('error', (err) => reject(err));
        req.write(data);
        req.end();
    });
};

const sendMail = async (mailOptions) => {
    if (isEmailMockEnabled()) {
        console.log(`[MAIL] Mock send to ${JSON.stringify(mailOptions.to)} subject: ${mailOptions.subject}`);
        return { mocked: true, to: mailOptions.to, subject: mailOptions.subject };
    }

    if (!(hasSmtpCredentials || hasBrevoApi)) {
        return { skipped: true };
    }

    if (hasBrevoApi) {
        return sendViaBrevo(mailOptions);
    }

    return transporter.sendMail(mailOptions);
};

// Default headers and reply-to for better deliverability when domain setup is limited.
const LIST_UNSUBSCRIBE = process.env.EMAIL_LIST_UNSUBSCRIBE || FROM_EMAIL;
const REPLY_TO = EMAIL_REPLY_TO;
const defaultMailHeaders = {
    'List-Unsubscribe': `<mailto:${LIST_UNSUBSCRIBE}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
};

const sendOtpEmail = async (toEmail, otpCode, name) => {
    try {
        const mailOptions = {
            from: { name: FROM_NAME, email: FROM_EMAIL },
            to: toEmail,
            subject: 'Verify your Barangay Irawan Registration',
            replyTo: REPLY_TO,
            headers: defaultMailHeaders,
            text: `Hello ${name},\n\nThank you for registering. To complete your registration and proceed to Admin Approval, please verify your email using the OTP below:\n\n${otpCode}\n\nThis code will expire in 10 minutes.\n\nIf you did not request this, please ignore this email.`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                    <h2 style="color: #235b82; text-align: center;">Barangay Irawan</h2>
                    <p>Hello <strong>${name}</strong>,</p>
                    <p>Thank you for registering. To complete your registration and proceed to Admin Approval, please verify your email using the OTP below:</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <span style="font-size: 32px; font-weight: bold; background: #f6f0e6; padding: 10px 20px; border-radius: 6px; letter-spacing: 4px; color: #ba5b2a;">${otpCode}</span>
                    </div>
                    <p>This code will expire in <strong>10 minutes</strong>.</p>
                    <p style="font-size: 12px; color: #888; margin-top: 40px; text-align: center;">If you did not request this, please ignore this email.</p>
                </div>
            `
        };

        // Don't crash if email config is missing during dev testing
        if (shouldSkipEmailSend()) {
            console.log('Skipping email send because no Brevo API key or SMTP credentials are configured');
            return;
        }

        await sendMail(mailOptions);
        console.log(`OTP Email sent to ${toEmail}`);
    } catch (error) {
        console.error('Error sending OTP Email:', error);
        // We throw so the controller can handle it (optional)
    }
};


const sendPasswordResetEmail = async (toEmail, name, resetLink) => {
    try {
        const mailOptions = {
            from: { name: FROM_NAME, email: FROM_EMAIL },
            to: toEmail,
            subject: 'Reset your Barangay Irawan password',
            replyTo: REPLY_TO,
            headers: defaultMailHeaders,
            text: `Hello ${name},\n\nWe received a request to reset your password. Please copy and paste the link below in your browser:\n\n${resetLink}\n\nThis link will expire in 30 minutes.\n\nIf you did not request this, you can ignore this email.`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                    <h2 style="color: #235b82; text-align: center;">Barangay Irawan</h2>
                    <p>Hello <strong>${name}</strong>,</p>
                    <p>We received a request to reset your password. Click the button below to choose a new password:</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${resetLink}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background: #235b82; color: #ffffff; text-decoration: none; padding: 14px 24px; border-radius: 6px; font-weight: bold; word-break: break-word;">Reset Password</a>
                    </div>
                    <p style="font-size: 12px; color: #666; margin: 20px 0; text-align: center; word-break: break-all;">Or copy and paste this link in your browser: <br /><a href="${resetLink}" style="color: #235b82; text-decoration: underline; word-break: break-all;">${resetLink}</a></p>
                    <p>This link will expire in <strong>30 minutes</strong>.</p>
                    <p style="font-size: 12px; color: #888; margin-top: 40px; text-align: center;">If you did not request this, you can ignore this email and your password will remain unchanged.</p>
                </div>
            `
        };

        if (shouldSkipEmailSend()) {
            console.log('Skipping password reset email because no Brevo API key or SMTP credentials are configured');
            return;
        }

        await sendMail(mailOptions);
        console.log(`Password reset email sent to ${toEmail}`);
    } catch (error) {
        console.error('Error sending Password Reset Email:', error);
    }
};

const sendAdminEmailChangeVerificationEmail = async (toEmail, name, confirmationLink) => {
    try {
        const mailOptions = {
            from: { name: FROM_NAME, email: FROM_EMAIL },
            to: toEmail,
            subject: 'Confirm your new Barangay Irawan admin email',
            replyTo: REPLY_TO,
            headers: defaultMailHeaders,
            text: `Hello ${name},\n\nWe received a request to change the admin recovery email on your Barangay Irawan account. Please confirm the new email address by opening this link:\n\n${confirmationLink}\n\nIf you did not request this, you can ignore this message.`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                    <h2 style="color: #235b82; text-align: center;">Barangay Irawan</h2>
                    <p>Hello <strong>${name}</strong>,</p>
                    <p>We received a request to change the admin recovery email for your account. Confirm the new email address by clicking the button below:</p>
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${confirmationLink}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background: #235b82; color: #ffffff; text-decoration: none; padding: 14px 24px; border-radius: 6px; font-weight: bold; word-break: break-word;">Confirm New Email</a>
                    </div>
                    <p style="font-size: 12px; color: #666; margin: 20px 0; text-align: center; word-break: break-all;">Or copy and paste this link in your browser: <br /><a href="${confirmationLink}" style="color: #235b82; text-decoration: underline; word-break: break-all;">${confirmationLink}</a></p>
                    <p>If you did not request this, you can ignore this email and your current admin email will remain unchanged.</p>
                </div>
            `
        };

        if (shouldSkipEmailSend()) {
            console.log('Skipping admin email-change verification email because no Brevo API key or SMTP credentials are configured');
            return;
        }

        await sendMail(mailOptions);
        console.log(`Admin email-change verification email sent to ${toEmail}`);
    } catch (error) {
        console.error('Error sending Admin Email Change Verification Email:', error);
    }
};

const sendStatusUpdateEmail = async (toEmail, name, status, options = {}) => {
    try {
        const isApproved = status === 'approved';
        const statusColor = isApproved ? '#2e7d32' : '#d32f2f'; // Green or Red
        const statusMessage = isApproved 
            ? 'Congratulations! Your account registration has been <strong>APPROVED</strong> by the Barangay Admin. You may now login to the portal.'
            : 'We regret to inform you that your account registration has been <strong>REJECTED</strong>. Please ensure all your details and proof of residency are correct, and try registering again or visit the Barangay Hall for clarification.';
        const loginLink = isApproved ? String(options.loginLink || '').trim() : '';
        const loginTextLine = loginLink ? '\n\nLogin here: ' + loginLink : '';
        const forgotPasswordReminderText = isApproved
            ? '\n\nIf you forgot your password, click the Forgot Password button in the login form and provide your registered email to reset your password.'
            : '';
        const forgotPasswordReminderHtml = isApproved
            ? `
                    <div style="padding: 12px; border-left: 5px solid #235b82; background-color: #f2f8fd; margin: 16px 0;">
                        <p style="margin: 0; font-size: 14px; color: #1f3e58;">
                            If you forgot your password, click the <strong>Forgot Password</strong> button in the login form and provide your registered email to reset your password.
                        </p>
                    </div>
                `
            : '';
        const loginButtonHtml = loginLink
            ? `
                    <div style="text-align: center; margin: 22px 0 8px;">
                        <a href="${escapeHtml(loginLink)}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background: #235b82; color: #ffffff; text-decoration: none; padding: 14px 24px; border-radius: 6px; font-weight: bold; word-break: break-word;">Go to Login</a>
                    </div>
                    <p style="font-size: 12px; color: #666; margin: 10px 0 0; text-align: center; word-break: break-all;">Or copy and paste this link in your browser: <br /><a href="${escapeHtml(loginLink)}" style="color: #235b82; text-decoration: underline; word-break: break-all;">${escapeHtml(loginLink)}</a></p>
                `
            : '';

        const mailOptions = {
            from: { name: FROM_NAME, email: FROM_EMAIL },
            to: toEmail,
            subject: `Barangay Irawan - Registration ${isApproved ? 'Approved' : 'Rejected'}`,
            replyTo: REPLY_TO,
            headers: defaultMailHeaders,
            text: `Hello ${name},\n\n${statusMessage.replace(/<[^>]+>/g, '')}${loginTextLine}${forgotPasswordReminderText}\n\nThank you,\nBarangay Administration`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                    <h2 style="color: #235b82; text-align: center;">Barangay Irawan</h2>
                    <p>Hello <strong>${name}</strong>,</p>
                    <div style="padding: 15px; border-left: 5px solid ${statusColor}; background-color: #f9f9f9; margin: 20px 0;">
                        <p style="margin: 0; font-size: 16px;">${statusMessage}</p>
                    </div>
                    ${loginButtonHtml}
                    ${forgotPasswordReminderHtml}
                    <p>Thank you,</p>
                    <p><strong>Barangay Administration</strong></p>
                </div>
            `
        };

        if (shouldSkipEmailSend()) {
            console.log('Skipping email send because no Brevo API key or SMTP credentials are configured');
            return;
        }

        await sendMail(mailOptions);
        console.log(`Status Email sent to ${toEmail} for status: ${status}`);
    } catch (error) {
        console.error('Error sending Status Update Email:', error);
    }
};


const sendDocumentStatusEmail = async (toEmail, name, documentType, status, adminNotes, details = []) => {
    try {
        const docTypeFormatted = formatLabel(documentType);
        let statusMessage = '';
        let statusColor;

        if (status === 'approved') {
            statusMessage = 'Great news! Your request for <strong>' + docTypeFormatted + '</strong> has been <strong>APPROVED</strong>. We are now preparing your document.';
            statusColor = '#2e7d32';
        } else if (status === 'processing') {
            statusMessage = 'Your request for <strong>' + docTypeFormatted + '</strong> is now <strong>Processing</strong>. Our staff is preparing your document.';
            statusColor = '#cc7000';
        } else if (status === 'ready_for_pickup') {
            statusMessage = 'Excellent! Your request for <strong>' + docTypeFormatted + '</strong> is now <strong>Ready for Pickup</strong> at the Barangay Hall.';
            statusColor = '#257f49';
        } else if (status === 'rejected') {
            statusMessage = 'Your request for <strong>' + docTypeFormatted + '</strong> has been <strong>Rejected</strong>. ' + (adminNotes ? 'Please see the admin notes below for details.' : '');
            statusColor = '#d52a2a';
        } else if (status === 'completed') {
            statusMessage = 'Thank you! Your request for <strong>' + docTypeFormatted + '</strong> has been marked as <strong>Completed</strong>. We hope the document serves you well.';
            statusColor = '#235b82';
        } else {
            return; // Don't send email for pending or cancelled states unless specified
        }

        const notesSection = adminNotes ? `<div style="margin-top: 15px; padding: 10px; background: #fff; border: 1px dashed #ccc; font-style: italic;"><strong>Admin Note:</strong> ${escapeHtml(adminNotes)}</div>` : '';
        const adminNoteText = adminNotes ? `Admin Note: ${adminNotes}\n` : '';
        const detailsText = buildDetailsText(details);
        const detailsSection = buildDetailsHtml(details);

        const mailOptions = {
            from: { name: FROM_NAME, email: FROM_EMAIL },
            to: toEmail,
            subject: `Barangay Irawan - Document Request Update: ${formatLabel(status)}`,
            replyTo: REPLY_TO,
            headers: defaultMailHeaders,
            text: `Hello ${name},\n\n${statusMessage.replace(/<[^>]+>/g, '')}\n\n${detailsText}${adminNoteText}\nThank you,\nBarangay Administration`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                    <h2 style="color: #257f49; text-align: center;">Barangay Irawan</h2>
                    <p>Hello <strong>${escapeHtml(name)}</strong>,</p>
                    <div style="padding: 15px; border-left: 5px solid ${statusColor}; background-color: #f9f9f9; margin: 20px 0;">
                        <p style="margin: 0; font-size: 16px;">${statusMessage}</p>
                        ${detailsSection}
                        ${notesSection}
                    </div>
                    <p>Thank you,</p>
                    <p><strong>Barangay Administration</strong></p>
                </div>
            `
        };

        if (shouldSkipEmailSend()) {
            console.log('Skipping document email send because no Brevo API key or SMTP credentials are configured');
            return;
        }

        await sendMail(mailOptions);
        console.log('Document Status Email sent to ' + toEmail + ' for status: ' + status);
    } catch (error) {
        console.error('Error sending Document Status Update Email:', error);
    }
};

const sendRequestStatusEmail = async (toEmail, name, requestLabel, status, adminNotes, details = []) => {
    try {
        const normalizedStatus = String(status || '').toLowerCase();
        const formattedLabel = formatLabel(requestLabel);
        let statusMessage = '';
        let statusColor = '#235b82';

        if (['approved', 'resolved', 'completed'].includes(normalizedStatus)) {
            statusMessage = `Good news! Your ${formattedLabel} request has been <strong>${normalizedStatus.toUpperCase()}</strong>.`;
            statusColor = '#2e7d32';
        } else if (['rejected', 'cancelled'].includes(normalizedStatus)) {
            statusMessage = `Your ${formattedLabel} request has been <strong>${normalizedStatus.toUpperCase()}</strong>.`;
            statusColor = '#d32f2f';
        } else if (normalizedStatus === 'rescheduled') {
            statusMessage = `Your ${formattedLabel} request has been <strong>RESCHEDULED</strong>. Please review the updated schedule.`;
            statusColor = '#cc7000';
        } else if (['reviewing', 'in_progress', 'processing'].includes(normalizedStatus)) {
            statusMessage = `Your ${formattedLabel} request is now <strong>${normalizedStatus.replace('_', ' ').toUpperCase()}</strong>.`;
            statusColor = '#cc7000';
        } else {
            statusMessage = `Your ${formattedLabel} request status has been updated to <strong>${formatLabel(normalizedStatus)}</strong>.`;
        }

        const notesSection = adminNotes ? `<div style="margin-top: 15px; padding: 10px; background: #fff; border: 1px dashed #ccc; font-style: italic;"><strong>Admin Note:</strong> ${escapeHtml(adminNotes)}</div>` : '';
        const adminNoteText = adminNotes ? `Admin Note: ${adminNotes}\n` : '';
        const detailsText = buildDetailsText(details);
        const detailsSection = buildDetailsHtml(details);

        const mailOptions = {
            from: { name: FROM_NAME, email: FROM_EMAIL },
            to: toEmail,
            subject: `Barangay Irawan - ${formattedLabel} Update: ${formatLabel(normalizedStatus)}`,
            replyTo: REPLY_TO,
            headers: defaultMailHeaders,
            text: `Hello ${name},\n\n${statusMessage.replace(/<[^>]+>/g, '')}\n\n${detailsText}${adminNoteText}\nThank you,\nBarangay Administration`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                    <h2 style="color: #257f49; text-align: center;">Barangay Irawan</h2>
                    <p>Hello <strong>${escapeHtml(name)}</strong>,</p>
                    <div style="padding: 15px; border-left: 5px solid ${statusColor}; background-color: #f9f9f9; margin: 20px 0;">
                        <p style="margin: 0; font-size: 16px;">${statusMessage}</p>
                        ${detailsSection}
                        ${notesSection}
                    </div>
                    <p>Thank you,</p>
                    <p><strong>Barangay Administration</strong></p>
                </div>
            `
        };

        if (shouldSkipEmailSend()) {
            console.log('Skipping request status email because no Brevo API key or SMTP credentials are configured');
            return;
        }

        await sendMail(mailOptions);
        console.log(`Request Status Email sent to ${toEmail} for status: ${status}`);
    } catch (error) {
        console.error('Error sending Request Status Update Email:', error);
    }
};

const sendGeneratedDocumentEmail = async (toEmail, name, documentType, filePath, options = {}) => {
    try {
        const docTypeFormatted = formatLabel(documentType);
        let htmlBody = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                    <h2 style="color: #257f49; text-align: center;">Barangay Irawan</h2>
                    <p>Hello <strong>${name}</strong>,</p>
                    <div style="padding: 15px; border-left: 5px solid #257f49; background-color: #f9f9f9; margin: 20px 0;">
                        <p style="margin: 0; font-size: 16px;">Your requested <strong>${docTypeFormatted}</strong> is now ready!</p>
                        <p style="margin: 12px 0 0; font-size: 14px; color: #8a1f11; font-weight: bold;">NOT VALID FOR OFFICIAL USE. This soft copy is for request tracking and reference only.</p>
                    </div>
                    <p><strong>Document Details:</strong></p>
                    <ul style="line-height: 1.8;">
                        <li><strong>Document Type:</strong> ${docTypeFormatted}</li>
                        <li><strong>Issued by:</strong> Barangay Irawan, Puerto Princesa City</li>
                        <li><strong>Date Issued:</strong> ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</li>
                    </ul>
                    <p style="margin-top: 20px;">If you have any questions or concerns about your document, please don't hesitate to contact the Barangay Hall.</p>
                    <p>Thank you,</p>
                    <p><strong>Barangay Administration</strong></p>
                    <hr style="border: none; border-top: 1px solid #e0e0e0; margin-top: 30px;">
                    <p style="font-size: 12px; color: #888; text-align: center;">This is an automated email. Please do not reply to this address.</p>
                </div>
            `;

        const textBody = `Hello ${name},\n\nYour requested ${docTypeFormatted} is now ready!\n\nNOT VALID FOR OFFICIAL USE. This soft copy is for request tracking and reference only.\n\nDocument Details:\n- Document Type: ${docTypeFormatted}\n- Issued by: Barangay Irawan, Puerto Princesa City\n- Date Issued: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}\n\nIf you have any questions or concerns about your document, please don't hesitate to contact the Barangay Hall.\n\nThank you,\nBarangay Administration`;

        const mailOptions = {
            from: { name: FROM_NAME, email: FROM_EMAIL },
            to: toEmail,
            subject: `${docTypeFormatted} from Barangay Irawan`,
            replyTo: REPLY_TO,
            headers: defaultMailHeaders,
            text: textBody,
            html: htmlBody
        };

        if (Buffer.isBuffer(options.attachmentBuffer)) {
            mailOptions.attachments = [{
                filename: `${documentType}.pdf`,
                content: options.attachmentBuffer,
                contentType: 'application/pdf'
            }];
        } else if (typeof filePath === 'string' && (filePath.startsWith('http://') || filePath.startsWith('https://')) ) {
            // If filePath is remote (presigned URL), include link in email instead of attachment
            mailOptions.text = textBody + `\n\nDownload Link: ${filePath}`;
            mailOptions.html = htmlBody + `\n<p style="margin-top:12px; text-align:center;"><a href="${filePath}" target="_blank" rel="noopener noreferrer" style="display:inline-block; background:#257f49; color:#fff; padding:10px 14px; border-radius:6px; text-decoration:none;">Download Document</a></p>`;
        } else if (typeof filePath === 'string' && filePath) {
            mailOptions.attachments = [{ filename: `${documentType}.pdf`, path: resolveAttachmentPath(filePath) }];
        }
        

        if (shouldSkipEmailSend()) {
            console.log('Skipping document email send because no Brevo API key or SMTP credentials are configured');
            return;
        }

        await sendMail(mailOptions);
        console.log(`Generated document email sent to ${toEmail} for document: ${documentType}`);
    } catch (error) {
        console.error('Error sending generated document email:', error);
        throw error;
    }
};

const sendCustomResidentEmail = async (toEmail, name, subject, message) => {
    try {
        const mailOptions = {
            from: { name: FROM_NAME, email: FROM_EMAIL },
            to: toEmail,
            subject: subject || 'Barangay Resident Notification',
            replyTo: REPLY_TO,
            headers: defaultMailHeaders,
            text: `Hello ${name || 'Resident'},\n\n${(message || '').replace(/<[^>]+>/g, '')}\n\nThank you,\nBarangay Administration`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                    <h2 style="color: #257f49; text-align: center;">Barangay Irawan</h2>
                    <p>Hello <strong>${name || 'Resident'}</strong>,</p>
                    <div style="padding: 15px; border-left: 5px solid #235b82; background-color: #f9f9f9; margin: 20px 0;">
                        <p style="margin: 0; font-size: 16px; white-space: pre-wrap;">${String(message || '').trim()}</p>
                    </div>
                    <p>Thank you,</p>
                    <p><strong>Barangay Administration</strong></p>
                </div>
            `
        };

        if (shouldSkipEmailSend()) {
            console.log('Skipping custom resident email because no Brevo API key or SMTP credentials are configured');
            return { sent: false, skipped: true, reason: 'missing_config' };
        }

        const result = await sendMail(mailOptions);
        console.log(`Custom resident email sent to ${toEmail}`);
        return { sent: true, result };
    } catch (error) {
        console.error('Error sending custom resident email:', error);
        return { sent: false, error };
    }
};

const sendDisasterAdvisoryEmail = async (toEmail, name, advisory, details = []) => {
    try {
        const disasterType = formatLabel(advisory?.disasterType || 'disaster');
        const severity = formatLabel(advisory?.severity || 'medium');
        const title = String(advisory?.title || '').trim() || `${disasterType} Advisory`;
        const impactDate = advisory?.expectedImpactDate
            ? new Date(advisory.expectedImpactDate).toLocaleString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            })
            : 'To be announced';
        const message = String(advisory?.advisoryMessage || '').trim();
        const detailsText = buildDetailsText(details, 'Details');
        const detailsSection = buildDetailsHtml(details, 'Details');

        const mailOptions = {
            from: { name: FROM_NAME, email: FROM_EMAIL },
            to: toEmail,
            subject: `Barangay Irawan Alert: ${title}`,
            replyTo: REPLY_TO,
            headers: defaultMailHeaders,
            text: `Hello ${name || 'Resident'},\n\n${title}\n\nType: ${disasterType}\nSeverity: ${severity}\nExpected Impact: ${impactDate}\n\n${message}\n\n${detailsText}Please follow barangay safety instructions and prepare as needed.\n\nThank you,\nBarangay Administration`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                    <h2 style="color: #257f49; text-align: center;">Barangay Irawan</h2>
                    <p>Hello <strong>${escapeHtml(name || 'Resident')}</strong>,</p>
                    <div style="padding: 15px; border-left: 5px solid #d52a2a; background-color: #fff8f6; margin: 20px 0;">
                        <p style="margin: 0 0 8px 0; font-size: 16px;"><strong>${escapeHtml(title)}</strong></p>
                        <p style="margin: 0 0 6px 0;"><strong>Type:</strong> ${escapeHtml(disasterType)}</p>
                        <p style="margin: 0 0 6px 0;"><strong>Severity:</strong> ${escapeHtml(severity)}</p>
                        <p style="margin: 0 0 12px 0;"><strong>Expected Impact:</strong> ${escapeHtml(impactDate)}</p>
                        <p style="margin: 0; white-space: pre-wrap;">${escapeHtml(message)}</p>
                        ${detailsSection}
                    </div>
                    <p>Please follow barangay safety instructions and prepare as needed.</p>
                    <p>Thank you,</p>
                    <p><strong>Barangay Administration</strong></p>
                </div>
            `
        };

        if (shouldSkipEmailSend()) {
            console.log('Skipping disaster advisory email because no Brevo API key or SMTP credentials are configured');
            return;
        }

        await sendMail(mailOptions);
        console.log(`Disaster advisory email sent to ${toEmail}`);
    } catch (error) {
        console.error('Error sending Disaster Advisory Email:', error);
    }
};

module.exports = {
    sendOtpEmail,
    sendPasswordResetEmail,
    sendAdminEmailChangeVerificationEmail,
    sendStatusUpdateEmail,
    sendDocumentStatusEmail,
    sendRequestStatusEmail,
    sendGeneratedDocumentEmail,
    sendCustomResidentEmail,
    sendDisasterAdvisoryEmail
};
