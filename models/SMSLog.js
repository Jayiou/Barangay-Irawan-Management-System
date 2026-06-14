const mongoose = require('../config/mongoose');

const smsLogSchema = new mongoose.Schema(
    {
        phoneNumber: {
            type: String,
            required: true,
            trim: true
        },
        messageType: {
            type: String,
            enum: [
                'document_status',
                'resident_approval',
                'resident_update',
                'appointment_confirmation',
                'facility_reservation',
                'report_status',
                'manpower_status',
                'registration_otp',
                'health_queue',
                'disaster_advisory'
            ],
            required: true
        },
        messageContent: {
            type: String,
            required: true,
            trim: true
        },
        provider: {
            type: String,
            trim: true,
            default: 'twilio'
        },
        providerMessageId: {
            type: String,
            trim: true,
            default: ''
        },
        providerStatus: {
            type: String,
            trim: true,
            default: ''
        },
        providerError: {
            type: String,
            trim: true,
            default: ''
        },
        providerErrorCode: {
            type: String,
            trim: true,
            default: ''
        },
        recipientId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Resident'
        },
        referenceId: {
            type: String,
            trim: true,
            default: ''
        },
        status: {
            type: String,
            enum: ['sent', 'failed', 'mocked'],
            default: 'sent'
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model('SMSLog', smsLogSchema);
