const path = require('node:path');
const fs = require('node:fs').promises;
const fsSync = require('node:fs');
const { pathToFileURL } = require('node:url');
const { ensureDirectory, publicUploadDirectory } = require('../utils/uploadPaths');
const { sendDocumentStatusEmail, sendGeneratedDocumentEmail } = require('../utils/mailer');
const { sendDocumentStatusSMS } = require('../utils/sms');
const { createDocumentPdfBuffer } = require('../utils/documentPdfGenerator');
const StatusAuditLog = require('../models/StatusAuditLog');
const DocumentRequest = require('../models/DocumentRequest');
const Resident = require('../models/Resident');
const Official = require('../models/Official');

const TEMPLATE_DIR = path.join(__dirname, '..', 'Certification new');
const LOGO_DIR = path.join(TEMPLATE_DIR, 'logos');
const DOCUMENT_REQUEST_TYPES = new Set(['certificate', 'clearance', 'indigency', 'barangay_id', 'other']);
const GENERATABLE_DOCUMENT_TYPES = new Set(['certificate', 'clearance', 'indigency']);

const canGenerateDocument = (type) => GENERATABLE_DOCUMENT_TYPES.has(String(type || '').toLowerCase());
const requiresRequestDetails = (type) => ['barangay_id', 'other'].includes(String(type || '').toLowerCase());

const residentPopulateFields = 'firstName lastName middleName suffix birthDate contactNumber email address userId';

const resolveResidentForUser = async (userId) => {
  if (!userId) return null;
  return Resident.findOne({ userId }).select(residentPopulateFields);
};

const getResidentName = (resident) => (
  [resident?.firstName, resident?.middleName, resident?.lastName, resident?.suffix]
    .filter(Boolean)
    .join(' ')
    .trim() || 'Resident'
);

const formatDocumentLabel = (value) => String(value || '')
  .replaceAll('_', ' ')
  .replace(/\b\w/g, (char) => char.toUpperCase());

const getDocumentFieldValue = (doc, key) => {
  if (!doc?.fields) return '';
  if (typeof doc.fields.get === 'function') {
    return doc.fields.get(key) || '';
  }

  return doc.fields[key] || '';
};

const buildDocumentEmailDetails = (doc, status) => [
  { label: 'Request Type', value: 'Document Request' },
  { label: 'Document Type', value: formatDocumentLabel(doc?.type) },
  { label: 'Purpose', value: doc?.purpose || getDocumentFieldValue(doc, 'PURPOSE') },
  { label: 'Submitted Name', value: getDocumentFieldValue(doc, 'FULL_NAME') },
  { label: 'Status', value: formatDocumentLabel(status) }
];

const notifyDocumentStatus = async (doc, status, notes = '') => {
  const resident = doc?.resident;
  const recipientEmail = resident?.email || resident?.userId?.email || '';
  const recipientPhone = resident?.contactNumber || doc?.contactNumber || '';
  const name = getResidentName(resident);
  const notifications = [];

  if (recipientEmail) notifications.push(sendDocumentStatusEmail(
    recipientEmail, name, doc.type, status, notes, buildDocumentEmailDetails(doc, status)
  ));
  if (recipientPhone) notifications.push(sendDocumentStatusSMS(
    recipientPhone, name, doc.type, status, String(doc?._id || '')
  ));

  await Promise.allSettled(notifications);
};

const isObjectLike = (value) => value && typeof value === 'object';

const getRequestBaseUrl = (req) => {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'http';
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const host = forwardedHost || req.get('host');

  if (!host) {
    return '';
  }

  return `${protocol}://${host}`;
};

const resolveAbsoluteFileUrl = (req, fileUrl) => {
  if (!fileUrl) {
    return '';
  }

  const value = String(fileUrl);
  if (/^(https?:)?\/\//i.test(value) || value.startsWith('data:') || value.startsWith('blob:')) {
    return value;
  }

  const baseUrl = getRequestBaseUrl(req);
  if (!baseUrl) {
    return value;
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
};

const resolveDocumentGeneratedFileUrl = (req, docReq) => {
  if (!docReq) {
    return '';
  }

  if (process.env.S3_BUCKET && docReq.generatedFileName) {
    return resolveAbsoluteFileUrl(req, docReq.generatedFileUrl || '');
  }

  const rawFileUrl = docReq.generatedFileUrl || (docReq.generatedFileName ? `/uploads/${docReq.generatedFileName}` : '');
  return resolveAbsoluteFileUrl(req, rawFileUrl);
};

const serializeDocumentRequest = (doc) => {
  if (!doc) return doc;
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };

  plain.fields = normalizeFieldMap(plain.fields);
  plain.adminEdits = normalizeFieldMap(plain.adminEdits);

  if (!plain.resident && doc.$locals?.legacyResident) {
    plain.resident = typeof doc.$locals.legacyResident.toObject === 'function'
      ? doc.$locals.legacyResident.toObject()
      : doc.$locals.legacyResident;
  }
  if (plain.resident && !isObjectLike(plain.resident)) {
    plain.residentId = plain.resident;
    plain.resident = null;
  }
  return plain;
};

const serializeDocumentRequestForResponse = (req, doc) => {
  const plain = serializeDocumentRequest(doc);
  if (!plain) {
    return plain;
  }

  plain.generatedFileUrl = resolveDocumentGeneratedFileUrl(req, plain);
  return plain;
};

const attachLegacyResidentFallbacks = async (docs) => {
  const list = Array.isArray(docs) ? docs : [docs];
  const missingResidentIds = [
    ...new Set(
      list
        .filter((doc) => doc && !doc.resident && (doc.populated?.('resident') || doc._doc?.resident))
        .map((doc) => String(doc.populated?.('resident') || doc._doc.resident))
    )
  ];

  if (!missingResidentIds.length) return;

  const residents = await Resident.find({ userId: { $in: missingResidentIds } }).select(residentPopulateFields);
  const residentsByUserId = new Map(residents.map((resident) => [String(resident.userId), resident]));

  list.forEach((doc) => {
    if (!doc || doc.resident || !(doc.populated?.('resident') || doc._doc?.resident)) return;
    const resident = residentsByUserId.get(String(doc.populated?.('resident') || doc._doc.resident));
    if (resident) {
      doc.resident = resident;
      doc.$locals.legacyResident = resident;
    }
  });
};

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const normalizeFieldMap = (fields) => {
  const normalized = {};
  const source = fields instanceof Map ? Object.fromEntries(fields) : fields || {};
  Object.entries(source).forEach(([key, value]) => {
    normalized[String(key).trim().toUpperCase()] = String(value ?? '').trim();
  });
  return normalized;
};

const calculateAge = (birthDate) => {
  if (!birthDate) return '';
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return '';
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDelta = today.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age > 0 ? String(age) : '';
};

const injectDocumentPrintStyles = (html) => html.replace('</head>', `
  <style>
    @page { size: A4 portrait; margin: 0; }
    @media screen, print {
      html, body { background: #fff !important; margin: 0 !important; color: #111827 !important; }
      .page {
        width: 210mm !important;
        min-height: 297mm !important;
        margin: 0 auto !important;
        padding: 18mm 16mm 20mm !important;
        border: 0 !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        overflow: hidden !important;
      }
      .header {
        grid-template-columns: 92px 1fr 92px !important;
        align-items: center !important;
        margin-bottom: 24mm !important;
        padding-bottom: 8mm !important;
      }
      .header-logo {
        width: 84px !important;
        height: 84px !important;
        margin-left: 0 !important;
        transform: none !important;
      }
      .header-logo.right-logo { width: 76px !important; height: 76px !important; }
      .header-content h1 { font-size: 24px !important; }
      .header-content h2 { font-size: 17px !important; }
      .cert-seal { width: 125mm !important; height: 125mm !important; opacity: 0.08 !important; }
      .cert-seal img { opacity: 1 !important; }
      .certificate-body {
        position: relative !important;
        left: auto !important;
        right: auto !important;
        bottom: auto !important;
        margin-top: 18mm !important;
      }
      .body-text { font-size: 16px !important; line-height: 1.85 !important; margin-bottom: 8mm !important; }
      .fill-underline {
        display: inline-block !important;
        min-width: 30mm !important;
        height: 1.35em !important;
        line-height: 1.2 !important;
        text-align: center !important;
        font-weight: 700 !important;
        border-bottom: 1px solid #111827 !important;
        padding: 0 2mm !important;
      }
      .fill-underline.short { min-width: 16mm !important; width: auto !important; }
      .fill-underline.medium { min-width: 42mm !important; width: auto !important; }
      .fill-underline.long { min-width: 72mm !important; width: auto !important; }
      .sig-block { position: absolute !important; bottom: 32mm !important; width: 70mm !important; }
      .sig-block.secretary { left: 18mm !important; }
      .sig-block.punong-barangay { right: 18mm !important; }
      .sig-line { margin-top: 18mm !important; }
    }
  </style>
</head>`);

const renderTemplate = async (templateName, data) => {
  const filePath = path.join(TEMPLATE_DIR, templateName);
  let html = await fs.readFile(filePath, 'utf8');
  const logoDataUrls = {
    'Bagong_Pilipinas_logo.png': `data:image/png;base64,${await fs.readFile(path.join(LOGO_DIR, 'Bagong_Pilipinas_logo.png'), 'base64')}`,
    'New irawan logo.png': `data:image/png;base64,${await fs.readFile(path.join(LOGO_DIR, 'New irawan logo.png'), 'base64')}`
  };

  html = html.replace(/src="logos\/([^"]+)"/g, (_, filename) => `src="${logoDataUrls[filename] || pathToFileURL(path.join(LOGO_DIR, filename)).href}"`);
  html = injectDocumentPrintStyles(html);

  // Replace {{ KEY }} placeholders with provided data.
  Object.keys(data || {}).forEach((key) => {
    const re = new RegExp(String.raw`{{\s*` + key + String.raw`\s*}}`, 'g');
    html = html.replace(re, escapeHtml(data[key]));
  });

  // Remove any leftover placeholders
  html = html.replace(/{{\s*[^}]+\s*}}/g, '');

  return html;
};

const resolveTemplateForType = (type) => {
  if (type === 'clearance') return 'barangay_clearance_single.html';
  if (type === 'indigency') return 'barangay_indigency_single.html';
  return 'barangay_certificate.html';
};

const buildDocumentPdfData = async (docReq) => {
  // Merge resident info, fields, and adminEdits so both admin/requester copies use the same final values.
  const resident = docReq.resident || docReq.$locals?.legacyResident || {};
  const merged = normalizeFieldMap(docReq.fields);

  if (docReq.adminEdits) {
    Object.assign(merged, normalizeFieldMap(docReq.adminEdits));
  }

  const now = new Date();
  const residentName = [resident.firstName, resident.middleName, resident.lastName, resident.suffix].filter(Boolean).join(' ').trim();

  const captain = await Official.findOne({ position: 'Barangay Captain', status: 'active' });
  const secretary = await Official.findOne({ position: 'Barangay Secretary', status: 'active' });

  return {
    ...merged,
    // Use form-submitted FULL_NAME if present; fallback to resident profile only when needed.
    FULL_NAME: merged.FULL_NAME || residentName,
    AGE: merged.AGE || calculateAge(resident.birthDate),
    BARANGAY: merged.BARANGAY || 'Irawan',
    CITY: merged.CITY || 'Puerto Princesa City',
    PROVINCE: merged.PROVINCE || 'Palawan',
    DAY: String(now.getDate()),
    MONTH: now.toLocaleString('en-US', { month: 'long' }),
    PURPOSE: merged.PURPOSE || docReq.purpose || '',
    SECRETARY_NAME: secretary?.name || 'Barangay Secretary',
    CAPTAIN_NAME: captain?.name || 'Punong Barangay'
  };
};

const resolveGeneratedDocumentFilePath = (docReq) => {
  const generatedName = docReq?.generatedFileName;
  const generatedUrl = docReq?.generatedFileUrl;

  if (generatedName) {
    const { resolvePublicUploadFilePath } = require('../utils/uploadPaths');
    return resolvePublicUploadFilePath(generatedName);
  }

  if (generatedUrl) {
    const fileName = path.basename(String(generatedUrl).split('?')[0].split('#')[0]);
    if (fileName) {
      const { resolvePublicUploadFilePath } = require('../utils/uploadPaths');
      return resolvePublicUploadFilePath(fileName);
    }
  }

  return '';
};

// Simple in-memory concurrency limiter for PDF generation to avoid OOM
let _pdfGenerationTokens = 0;
const MAX_PDF_CONCURRENCY = Number(process.env.MAX_PDF_CONCURRENCY) || 1;
const acquirePdfToken = async () => {
  while (true) {
    if (_pdfGenerationTokens < MAX_PDF_CONCURRENCY) {
      _pdfGenerationTokens += 1;
      return;
    }

    // backoff briefly while other jobs complete
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 200));
  }
};
const releasePdfToken = () => {
  _pdfGenerationTokens = Math.max(0, _pdfGenerationTokens - 1);
};

const savePdfBuffer = async (pdfBuffer, docReq) => {
  const filename = `document-${docReq._id}-${Date.now()}.pdf`;
  let fileUrl = `/uploads/${filename}`;

  if (process.env.S3_BUCKET) {
    try {
      const { uploadBuffer } = require('../utils/s3');
      const key = `generated-documents/${filename}`;
      const result = await uploadBuffer(key, pdfBuffer, 'application/pdf');
      fileUrl = result.url;
      docReq.generatedFileName = key;
    } catch (s3Err) {
      console.error('S3 upload failed, falling back to local write:', s3Err.message || s3Err);
      const outPath = path.join(publicUploadDirectory, filename);
      await fs.writeFile(outPath, pdfBuffer);
      docReq.generatedFileName = filename;
    }
  } else {
    const outPath = path.join(publicUploadDirectory, filename);
    await fs.writeFile(outPath, pdfBuffer);
    docReq.generatedFileName = filename;
  }

  return fileUrl;
};

const sendDocumentEmail = async (docReq, fileUrl, options = {}) => {
  try {
    const residentEmail = docReq.resident?.email || docReq.resident?.userId?.email;
    const name = docReq.resident
      ? `${docReq.resident.firstName || ''} ${docReq.resident.lastName || ''}`.trim()
      : '';
    if (residentEmail) {
      await sendGeneratedDocumentEmail(residentEmail, name || 'Resident', docReq.type || 'document', fileUrl, options);
    }
  } catch (emailErr) {
    console.error('Failed to send generated document email:', emailErr.message || emailErr);
    throw emailErr;
  }
};

exports.createRequest = async (req, res, next) => {
  try {
    const resident = req.user?._id ? await resolveResidentForUser(req.user._id) : await Resident.findById(req.body.residentId);
    const { type, fields, purpose } = req.body;
    const normalizedType = String(type || '').trim().toLowerCase();
    const normalizedPurpose = String(purpose || '').trim();

    if (!resident) {
      return res.status(400).json({ success: false, message: 'Resident profile required' });
    }
    if (!DOCUMENT_REQUEST_TYPES.has(normalizedType)) {
      return res.status(400).json({ success: false, message: 'Invalid request type' });
    }
    if (requiresRequestDetails(normalizedType) && !normalizedPurpose) {
      return res.status(400).json({ success: false, message: 'Request details are required for this request type.' });
    }

    const newReq = await DocumentRequest.create({
      resident: resident._id,
      type: normalizedType,
      fields: normalizeFieldMap(fields),
      purpose: normalizedPurpose
    });

    return res.json({ success: true, data: newReq });
  } catch (err) {
    next(err);
  }
};

exports.getResidentRequests = async (req, res, next) => {
  try {
    const resident = req.user?._id ? await resolveResidentForUser(req.user._id) : await Resident.findById(req.query.residentId);
    if (!resident) return res.status(400).json({ success: false, message: 'Resident profile required' });

    const residentIds = [resident._id];
    if (req.user?._id) {
      residentIds.push(req.user._id);
    }

    const list = await DocumentRequest.find({ resident: { $in: residentIds } }).sort({ updatedAt: -1, createdAt: -1 });
    res.json({ success: true, data: list });
  } catch (err) {
    next(err);
  }
};

exports.updateRequest = async (req, res, next) => {
  try {
    const reqId = req.params.id;
    const doc = await DocumentRequest.findById(reqId);

    if (!doc) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }

    const resident = req.user?._id ? await resolveResidentForUser(req.user._id) : null;
    if (!resident || doc.resident?.toString() !== resident._id.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    if (doc.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Only pending requests can be edited' });
    }

    const { type, fields, purpose } = req.body;
    const nextType = type ? String(type).trim().toLowerCase() : doc.type;
    const nextPurpose = purpose !== undefined ? String(purpose || '').trim() : String(doc.purpose || '').trim();
    if (!DOCUMENT_REQUEST_TYPES.has(nextType)) {
      return res.status(400).json({ success: false, message: 'Invalid request type' });
    }
    if (requiresRequestDetails(nextType) && !nextPurpose) {
      return res.status(400).json({ success: false, message: 'Request details are required for this request type.' });
    }
    if (type) {
      doc.type = nextType;
    }
    if (fields) {
      doc.fields = normalizeFieldMap(fields);
    }
    if (purpose !== undefined) {
      doc.purpose = nextPurpose;
    }

    await doc.save();
    res.json({ success: true, data: doc });
  } catch (err) {
    next(err);
  }
};

exports.deleteRequest = async (req, res, next) => {
  try {
    const reqId = req.params.id;
    const doc = await DocumentRequest.findById(reqId);

    if (!doc) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }

    if (req.user?.role === 'admin') {
      if (doc.status !== 'rejected') {
        return res.status(400).json({ success: false, message: `Cannot delete document request with status: ${doc.status}` });
      }
    } else {
      const resident = req.user?._id ? await resolveResidentForUser(req.user._id) : null;
      if (!resident || doc.resident?.toString() !== resident._id.toString()) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      if (doc.status !== 'pending') {
        return res.status(400).json({ success: false, message: 'Only pending requests can be deleted' });
      }
    }

    await DocumentRequest.findByIdAndDelete(reqId);
    res.json({ success: true, message: 'Document request deleted successfully' });
  } catch (err) {
    next(err);
  }
};

exports.adminDeleteRequest = async (req, res, next) => {
  try {
    const reqId = req.params.id;
    const doc = await DocumentRequest.findById(reqId);

    if (!doc) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }

    if (doc.status !== 'rejected') {
      return res.status(400).json({ success: false, message: `Cannot delete document request with status: ${doc.status}` });
    }

    await DocumentRequest.findByIdAndDelete(reqId);
    res.json({ success: true, message: 'Document request deleted successfully' });
  } catch (err) {
    next(err);
  }
};

exports.getAllRequests = async (req, res, next) => {
  try {
    const list = await DocumentRequest.find()
      .populate('resident', residentPopulateFields)
      .sort({ createdAt: -1 });
    await attachLegacyResidentFallbacks(list);
    res.json({ success: true, data: list.map((doc) => serializeDocumentRequestForResponse(req, doc)) });
  } catch (err) {
    next(err);
  }
};

exports.getRequestById = async (req, res, next) => {
  try {
    const reqId = req.params.id;
    const doc = await DocumentRequest.findById(reqId).populate('resident');
    if (!doc) return res.status(404).json({ success: false, message: 'Not found' });
    await attachLegacyResidentFallbacks(doc);
    res.json({ success: true, data: serializeDocumentRequestForResponse(req, doc) });
  } catch (err) {
    next(err);
  }
};

exports.requestRevision = async (req, res, next) => {
  try {
    const reqId = req.params.id;
    const revisionNote = String(req.body?.note || req.body?.requesterRevisionNote || '').trim();
    const doc = await DocumentRequest.findById(reqId).populate({
      path: 'resident',
      populate: { path: 'userId', select: 'email username' }
    });

    if (!doc) return res.status(404).json({ success: false, message: 'Not found' });
    await attachLegacyResidentFallbacks(doc);

    const resident = doc.resident || doc.$locals?.legacyResident || null;
    const requesterUserId = resident?.userId?._id || resident?.userId || req.user?._id;
    if (!requesterUserId || String(requesterUserId) !== String(req.user?._id)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    if (!doc.generatedEmailSentAt) {
      return res.status(400).json({ success: false, message: 'Revision requests are available after the soft copy has been sent.' });
    }

    if (!revisionNote) {
      return res.status(400).json({ success: false, message: 'Revision note is required.' });
    }

    const previousStatus = doc.status;
    doc.status = 'revision_requested';
    doc.requesterRevisionNote = revisionNote;
    doc.revisionRequestedAt = new Date();
    await doc.save();

    await StatusAuditLog.create({
      entityType: 'DocumentRequest',
      entityId: doc._id,
      previousStatus,
      newStatus: 'revision_requested',
      changedBy: req.user._id,
      changedByName: req.user.username || req.user.email || 'Requester',
      reason: revisionNote,
      actionDescription: 'Requester requested a document revision',
      additionalData: {
        requesterRevisionNote: revisionNote,
        documentType: doc.type,
        requesterEmail: resident?.email || resident?.userId?.email || ''
      }
    });

    res.json({ success: true, data: serializeDocumentRequestForResponse(req, doc) });
  } catch (err) {
    next(err);
  }
};

exports.adminEdit = async (req, res, next) => {
  try {
    const reqId = req.params.id;
    const { fields, purpose, status } = req.body;
    const doc = await DocumentRequest.findById(reqId);
    if (!doc) return res.status(404).json({ success: false, message: 'Not found' });
    if (!canGenerateDocument(doc.type)) {
      return res.status(400).json({ success: false, message: 'This request is managed through status updates only.' });
    }
    if (!['processing', 'revision_requested'].includes(doc.status)) {
      return res.status(400).json({ success: false, message: 'Document edits are only available while processing or under revision' });
    }

    if (fields) {
      Object.keys(fields).forEach((k) => doc.adminEdits.set(k, fields[k]));
    }

    if (purpose !== undefined) doc.purpose = purpose;
    if (status) doc.status = status;

    if (fields || purpose !== undefined) {
      doc.generatedAt = undefined;
      doc.generatedFileName = '';
      doc.generatedFileUrl = '';
    }

    await doc.save();
    res.json({ success: true, data: doc });
  } catch (err) {
    next(err);
  }
};

exports.approveRequest = async (req, res, next) => {
  try {
    const reqId = req.params.id;
    const doc = await DocumentRequest.findById(reqId).populate({
      path: 'resident',
      select: residentPopulateFields,
      populate: { path: 'userId', select: 'email username' }
    });
    if (!doc) return res.status(404).json({ success: false, message: 'Not found' });
    doc.status = 'approved';
    await doc.save();
    await notifyDocumentStatus(doc, 'approved');
    res.json({ success: true, data: doc });
  } catch (err) {
    next(err);
  }
};

exports.rejectRequest = async (req, res, next) => {
  try {
    const reqId = req.params.id;
    const reason = String(req.body?.reason || req.body?.adminNotes || '').trim();
    const doc = await DocumentRequest.findById(reqId).populate({
      path: 'resident',
      select: residentPopulateFields,
      populate: { path: 'userId', select: 'email username' }
    });
    if (!doc) return res.status(404).json({ success: false, message: 'Not found' });
    doc.status = 'rejected';
    doc.adminNotes = reason;
    await doc.save();
    await notifyDocumentStatus(doc, 'rejected', reason);
    res.json({ success: true, data: doc });
  } catch (err) {
    next(err);
  }
};

exports.generateDocument = async (req, res, next) => {
  try {
    const reqId = req.params.id;
    const docReq = await DocumentRequest.findById(reqId).populate({
      path: 'resident',
      populate: { path: 'userId', select: 'email username' }
    });
    if (!docReq) return res.status(404).json({ success: false, message: 'Not found' });
    await attachLegacyResidentFallbacks(docReq);
    if (!canGenerateDocument(docReq.type)) {
      return res.status(400).json({ success: false, message: 'PDF generation is not available for this request type.' });
    }
    if (!['processing', 'revision_requested'].includes(docReq.status)) {
      return res.status(400).json({ success: false, message: 'Document generation is only available while processing or under revision' });
    }

    // Determine if the client is requesting PDF generation (POST or query)
    const wantPdf = req.method === 'POST' || String(req.query.pdf || req.query.save || '').toLowerCase() === '1' || req.query.pdf === 'true';

    // If we've already generated this document and have a stored file/key, return a usable URL
    // instead of regenerating. For S3-stored keys, generate a fresh presigned URL on demand.
    if (wantPdf && docReq.generatedAt && (docReq.generatedFileUrl || docReq.generatedFileName)) {
      const storedFilePath = process.env.S3_BUCKET ? '' : resolveGeneratedDocumentFilePath(docReq);
      if (!process.env.S3_BUCKET && (!storedFilePath || !fsSync.existsSync(storedFilePath))) {
        docReq.generatedAt = undefined;
        docReq.generatedFileName = '';
        docReq.generatedFileUrl = '';
        await docReq.save();
      } else {
        let fileUrl = docReq.generatedFileUrl || (docReq.generatedFileName ? `/uploads/${docReq.generatedFileName}` : undefined);
        if (process.env.S3_BUCKET && docReq.generatedFileName) {
          try {
            const { getPresignedUrl } = require('../utils/s3');
            // If generatedFileName is an S3 key, produce a fresh presigned URL
            fileUrl = await getPresignedUrl(docReq.generatedFileName);
          } catch (e) {
            console.error('Failed to generate presigned URL for existing file:', e.message || e);
          }
        } else {
          fileUrl = resolveDocumentGeneratedFileUrl(req, docReq);
        }
        return res.json({ success: true, fileUrl, data: docReq });
      }
    }

    const data = await buildDocumentPdfData(docReq);

    let templateName = resolveTemplateForType(docReq.type);

    const html = await renderTemplate(templateName, data);

    if (!wantPdf) {
      res.setHeader('Content-Type', 'text/html');
      return res.send(html);
    }

    // Generate PDF directly to avoid Chromium memory spikes in constrained hosts.
    ensureDirectory(publicUploadDirectory);

    // limit concurrent PDF jobs to avoid memory spikes in constrained environments
    await acquirePdfToken();
    try {
      const pdfBuffer = await createDocumentPdfBuffer({ type: docReq.type, data, mode: 'admin' });

      const fileUrl = await savePdfBuffer(pdfBuffer, docReq);

      docReq.generatedAt = new Date();
      docReq.generatedFileUrl = fileUrl;
      await docReq.save();

      return res.json({ success: true, fileUrl: resolveDocumentGeneratedFileUrl(req, docReq), data: docReq });
    } finally {
      releasePdfToken();
    }
  } catch (err) {
    next(err);
  }
};

exports.sendGeneratedDocument = async (req, res, next) => {
  try {
    const reqId = req.params.id;
    const docReq = await DocumentRequest.findById(reqId).populate({
      path: 'resident',
      select: residentPopulateFields,
      populate: { path: 'userId', select: 'email username' }
    });

    if (!docReq) return res.status(404).json({ success: false, message: 'Not found' });
    await attachLegacyResidentFallbacks(docReq);

    if (!canGenerateDocument(docReq.type)) {
      return res.status(400).json({ success: false, message: 'Soft-copy sending is not available for this request type.' });
    }

    if (!docReq.generatedAt || (!docReq.generatedFileUrl && !docReq.generatedFileName)) {
      return res.status(400).json({ success: false, message: 'Generate the PDF before sending it to the requester.' });
    }

    const recipientEmail = docReq.resident?.email || docReq.resident?.userId?.email;
    if (!recipientEmail) {
      return res.status(400).json({ success: false, message: 'Requester email is not available.' });
    }

    let fileUrl = resolveDocumentGeneratedFileUrl(req, docReq);
    if (process.env.S3_BUCKET && docReq.generatedFileName) {
      try {
        const { getPresignedUrl } = require('../utils/s3');
        fileUrl = await getPresignedUrl(docReq.generatedFileName);
      } catch (error) {
        console.error('Failed to generate presigned URL for email:', error.message || error);
      }
    }

    const data = await buildDocumentPdfData(docReq);

    await acquirePdfToken();
    let requesterPdfBuffer;
    try {
      requesterPdfBuffer = await createDocumentPdfBuffer({ type: docReq.type, data, mode: 'requester' });
    } finally {
      releasePdfToken();
    }

    await sendDocumentEmail(docReq, fileUrl, { attachmentBuffer: requesterPdfBuffer });
    docReq.generatedEmailSentAt = new Date();
    await docReq.save();

    res.json({
      success: true,
      message: `Generated document sent to ${recipientEmail}.`,
      data: serializeDocumentRequestForResponse(req, docReq)
    });
  } catch (err) {
    next(err);
  }
};
