const mongoose = require('mongoose');

const digitalTokenSchema = new mongoose.Schema({
    voterId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    token: {
        type: String,
        required: true
    },
    qrCode: {
        type: String,
        required: true
    },
    pdfData: {
        type: String,
        required: true
    },
    generatedAt: {
        type: Date,
        default: Date.now,
        required: true
    },
    verifiedAt: {
        type: Date
    },
    status: {
        type: String,
        enum: ['active', 'used', 'expired', 'revoked'],
        default: 'active'
    }
}, {
    timestamps: true
});

// Index for faster queries
digitalTokenSchema.index({ voterId: 1 });
digitalTokenSchema.index({ status: 1 });

// Method to verify token
digitalTokenSchema.methods.verify = async function() {
    this.verifiedAt = new Date();
    this.status = 'used';
    return await this.save();
};

// Method to revoke token
digitalTokenSchema.methods.revoke = async function() {
    this.status = 'revoked';
    return await this.save();
};

// Method to check if token is valid
digitalTokenSchema.methods.isValid = function() {
    return this.status === 'active';
};

const DigitalToken = mongoose.model('DigitalToken', digitalTokenSchema);

module.exports = DigitalToken; 