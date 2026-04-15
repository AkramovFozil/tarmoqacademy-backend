const mongoose = require('mongoose');

const applicationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
  },
  surname: {
    type: String,
    required: [true, 'Surname is required'],
    trim: true,
  },
  phone: {
    type: String,
    required: [true, 'Phone is required'],
    trim: true,
  },
  course: {
    type: String,
    default: '',
    trim: true,
  },
  status: {
    type: String,
    enum: ['new', 'contacted', 'approved'],
    default: 'new',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Application', applicationSchema);
