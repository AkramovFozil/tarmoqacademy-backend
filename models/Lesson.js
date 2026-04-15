const mongoose = require('mongoose');

const lessonSchema = new mongoose.Schema(
  {
    moduleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Module',
      required: true,
    },
    title: {
      type: String,
      required: [true, 'Lesson title is required'],
      trim: true,
    },
    videoUrl: {
      type: String,
      default: '',
    },
    content: {
      type: String,
      default: '',
    },
    task: {
      type: String,
      default: '',
    },
    duration: {
      type: Number, // duration in minutes
      default: 0,
    },
    order: {
      type: Number,
      required: true,
      default: 1,
    },
  },
  { timestamps: true }
);

// Ensure lessons are ordered within a module
lessonSchema.index({ moduleId: 1, order: 1 });

module.exports = mongoose.model('Lesson', lessonSchema);
