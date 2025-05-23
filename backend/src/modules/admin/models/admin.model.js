import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const adminSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: [true, 'Full name is required'],
    trim: true,
    index: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email'],
    index: true
  },
  phoneNumber: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true,
    minLength: [10, 'Phone number must be at least 10 characters'],
    maxLength: [15, 'Phone number must not exceed 15 characters'],
    index: true
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minLength: [8, 'Password must be at least 8 characters'],
    select: false
  },
  role: {
    type: String,
    enum: ['Admin', 'Manager', 'Support', 'Agent'],
    default: 'Agent',
    index: true
  },
  department: {
    type: String,
    required: [true, 'Department is required'],
    trim: true,
    index: true
  },
  designation: {
    type: String,
    required: [true, 'Designation is required'],
    trim: true
  },
  address: {
    type: String,
    trim: true
  },
  dateOfJoining: {
    type: Date,
    default: Date.now
  },
  employeeId: {
    type: String,
    trim: true,
    unique: true,
    sparse: true,
    index: true
  },
  isSuperAdmin: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['Active', 'Inactive', 'On Leave'],
    default: 'Active',
    index: true
  },
  remarks: {
    type: String,
    trim: true
  },
  profileImage: {
    type: String
  },
  permissions: {
    dashboardAccess: {
      type: Boolean,
      default: true
    },
    userManagement: {
      type: Boolean,
      default: false
    },
    teamManagement: {
      type: Boolean,
      default: false
    },
    ordersShipping: {
      type: Boolean,
      default: false
    },
    financialOperations: {
      type: Boolean,
      default: false
    },
    systemConfig: {
      type: Boolean,
      default: false
    },
    sellerManagement: {
      type: Boolean,
      default: false
    },
    supportTickets: {
      type: Boolean,
      default: false
    },
    reportsAnalytics: {
      type: Boolean,
      default: false
    },
    marketingPromotions: {
      type: Boolean,
      default: false
    }
  },
  documents: {
    idProof: {
      name: String,
      url: String
    },
    employmentContract: {
      name: String,
      url: String
    }
  },
  passwordResetToken: String,
  passwordResetExpires: Date,
  lastLoginAt: {
    type: Date,
    index: true
  },
  lastLoginIP: String,
  lastActive: {
    type: Date,
    default: Date.now,
    index: true
  },
  statusHistory: [{
    status: {
      type: String,
      enum: ['Active', 'Inactive', 'On Leave']
    },
    reason: String,
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin'
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],
  permissionHistory: [{
    changes: {
      type: Object, // Stores the changed permissions
      required: true
    },
    reason: {
      type: String,
      default: 'Permission update'
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});

adminSchema.index({ role: 1, status: 1 });
adminSchema.index({ department: 1, status: 1 });
adminSchema.index({ fullName: 'text', email: 'text', phoneNumber: 'text' });

adminSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    this.password = await bcrypt.hash(this.password, 12);
    next();
  } catch (error) {
    next(error);
  }
});

adminSchema.pre(/^find/, function(next) {
  if (!this._conditions.status) {
    const skipDefaultFilter = 
      this.getOptions().skipDefaultFilter || 
      (this._conditions._id && Object.keys(this._conditions).length === 1);
    
    if (!skipDefaultFilter) {
      this.find({ status: { $ne: 'Inactive' } });
    }
  }
  next();
});

adminSchema.pre('save', function(next) {
  this.lastActive = new Date();
  next();
});

adminSchema.methods.isPasswordCorrect = async function(candidatePassword) {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    return false;
  }
};

adminSchema.methods.generateToken = function() {
  return jwt.sign(
    { 
      id: this._id,
      role: this.role,
      isSuperAdmin: this.isSuperAdmin
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
  );
};

adminSchema.statics.findByIdSafe = async function(id) {
  try {
    return await this.findById(id).select('-password').lean();
  } catch (error) {
    return null;
  }
};

adminSchema.methods.updateSafe = async function(updates) {
  const allowedFields = [
    'fullName', 'phoneNumber', 'department', 'designation', 
    'address', 'status', 'remarks', 'permissions'
  ];
  
  Object.keys(updates).forEach(key => {
    if (allowedFields.includes(key)) {
      this[key] = updates[key];
    }
  });
  
  if (updates.status && updates.status !== this.status) {
    if (!this.statusHistory) this.statusHistory = [];
    this.statusHistory.push({
      status: updates.status,
      reason: updates.reason || 'Status updated',
      updatedBy: updates.updatedBy,
      timestamp: new Date()
    });
  }
  
  return await this.save();
};

const Admin = mongoose.model('Admin', adminSchema);

export default Admin; 