const mongoose = require('mongoose');

const taskSubmissionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    lessonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lesson',
      required: true,
    },
    answer: {
      type: String,
      required: true,
      trim: true,
    },
    attachmentName: {
      type: String,
      default: '',
      trim: true,
    },
    attachmentSize: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewNote: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { timestamps: true }
);

taskSubmissionSchema.index({ userId: 1, lessonId: 1 }, { unique: true });
taskSubmissionSchema.index({ status: 1, updatedAt: -1 });

module.exports = mongoose.model('TaskSubmission', taskSubmissionSchema);
