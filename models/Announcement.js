const mongoose = require('../config/mongoose');

const announcementSchema = new mongoose.Schema(
    {
        title: {
            type: String,
            required: true,
            trim: true
        },
        description: {
            type: String,
            required: true
        },
        imageUrl: {
            type: String,
            required: false
        },
        imagePath: {
            type: String,
            required: false
        },
        isActive: {
            type: Boolean,
            default: true
        },
        isImportant: {
            type: Boolean,
            default: false
        },
        smsNotificationSentAt: {
            type: Date,
            default: null
        },
        smsNotifiedResidentCount: {
            type: Number,
            default: 0,
            min: 0
        },
        displayOrder: {
            type: Number,
            default: 1
        },
        startDate: {
            type: Date,
            required: true
        },
        endDate: {
            type: Date,
            required: false
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        }
    },
    {
        timestamps: true
    }
);

announcementSchema.statics.getNextDisplayOrder = async function getNextDisplayOrder() {
    const [result] = await this.aggregate([
        {
            $project: {
                displayOrderValue: {
                    $convert: {
                        input: '$displayOrder',
                        to: 'int',
                        onError: 0,
                        onNull: 0
                    }
                }
            }
        },
        {
            $group: {
                _id: null,
                maxDisplayOrder: { $max: '$displayOrderValue' }
            }
        }
    ]);

    return (Number(result?.maxDisplayOrder) || 0) + 1;
};

announcementSchema.pre('save', async function autoAssignDisplayOrder() {
    if (!this.isNew) {
        return;
    }

    const currentOrder = Number(this.displayOrder);
    if (Number.isFinite(currentOrder) && currentOrder > 0) {
        return;
    }

    this.displayOrder = await this.constructor.getNextDisplayOrder();
});

module.exports = mongoose.model('Announcement', announcementSchema);
