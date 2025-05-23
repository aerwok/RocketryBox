import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const sellerSchema = new mongoose.Schema({
  name: { type: String, required: true, index: true },
  email: { type: String, required: true, unique: true, lowercase: true, index: true },
  phone: { type: String, required: true, unique: true, index: true },
  password: { type: String, required: true, select: false },
  businessName: { type: String, required: true, index: true },
  companyCategory: { type: String },
  brandName: { type: String },
  website: { type: String },
  supportContact: { type: String },
  supportEmail: { type: String },
  operationsEmail: { type: String },
  financeEmail: { type: String },
  gstin: { type: String },
  documents: {
    gstin: { type: String },
    pan: { type: String },
    cin: { type: String },
    tradeLicense: { type: String },
    msmeRegistration: { type: String },
    aadhaar: { type: String },
    documents: [
      {
        name: { type: String },
        type: { type: String },
        url: { type: String },
        status: { type: String, enum: ['verified', 'pending', 'rejected'], default: 'pending' }
      }
    ]
  },
  status: { type: String, enum: ['pending', 'active', 'suspended'], default: 'pending', index: true },
  otp: {
    code: { type: String },
    expiresAt: { type: Date }
  },
  lastLogin: { type: Date },
  lastActive: { type: Date, default: Date.now, index: true },
  refreshToken: { type: String, select: false },
  walletBalance: { type: String, default: '0' },
  rateCard: { type: mongoose.Schema.Types.ObjectId, ref: 'RateCard', default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Add compound indexes for common query patterns
sellerSchema.index({ status: 1, lastActive: -1 });
sellerSchema.index({ businessName: 'text', email: 'text', phone: 'text' });

// Default filter to exclude suspended sellers
sellerSchema.pre(/^find/, function(next) {
  // Check if this query should skip the default filter
  const skipDefaultFilter = this.getOptions().skipDefaultFilter;
  
  // Apply default filter for normal queries
  if (!skipDefaultFilter && !this._conditions.status) {
    this.find({ status: { $ne: 'suspended' } });
  }
  next();
});

// Update lastActive and timestamps
sellerSchema.pre('save', function(next) {
  if (this.isModified('lastLogin')) {
    this.lastActive = new Date();
  }
  this.updatedAt = new Date();
  next();
});

// Hash password before save
sellerSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// Compare password
sellerSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Generate JWT
sellerSchema.methods.generateAuthToken = function () {
  return jwt.sign({ id: this._id, role: 'seller' }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '1d'
  });
};

// Generate Refresh Token
sellerSchema.methods.generateRefreshToken = function () {
  return jwt.sign({ id: this._id, role: 'seller' }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
  });
};

// Remove sensitive data
sellerSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.refreshToken;
  return obj;
};

// Static method to find a seller by ID safely
sellerSchema.statics.findByIdSafe = async function(id) {
  try {
    return await this.findById(id).lean();
  } catch (error) {
    return null;
  }
};

// Helper method for updating seller data safely
sellerSchema.methods.updateSafe = async function(updates) {
  const allowedFields = [
    'name', 'phone', 'businessName', 'companyCategory', 'brandName',
    'website', 'supportContact', 'supportEmail', 'operationsEmail', 'financeEmail'
  ];
  
  Object.keys(updates).forEach(key => {
    if (allowedFields.includes(key)) {
      this[key] = updates[key];
    }
  });
  
  this.lastActive = new Date();
  this.updatedAt = new Date();
  return await this.save();
};

export default mongoose.model('Seller', sellerSchema); 