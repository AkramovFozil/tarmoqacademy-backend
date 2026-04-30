const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    offlineLogin: {
      type: String,
      default: '',
      lowercase: true,
      trim: true,
      index: true,
    },
    phone: {
      type: String,
      default: '',
      trim: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: 6,
      select: false,
    },
    role: {
      type: String,
      enum: ['student', 'admin', 'offline_student'],
      default: 'student',
    },
    offlineStatus: {
      type: String,
      enum: ['active', 'frozen', 'completed'],
      default: 'active',
    },
    offlineNote: {
      type: String,
      default: '',
      trim: true,
    },
    offlineAccess: {
      courseId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Course',
        default: null,
      },
      allowedLessons: [
        { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson' }
      ],
    },
    avatar: {
      type: String,
      default: '',
    },
    courses: [
      { type: mongoose.Schema.Types.ObjectId, ref: 'Course' }
    ],
    enrolledCourses: [
  { type: mongoose.Schema.Types.ObjectId, ref: 'Course' }
],
    purchasedCourses: [
      { type: mongoose.Schema.Types.ObjectId, ref: 'Course' }
    ],
  },
  { timestamps: true }
  
);


// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
