const Notification = require('../models/Notification');
const User = require('../models/User');

const createNotification = async ({ userId, title, message, type }) => {
  if (!userId || !title || !message || !type) return null;

  return Notification.create({
    userId,
    title,
    message,
    type,
  });
};

const notifyAdmins = async ({ title, message, type }) => {
  const admins = await User.find({ role: 'admin' }).select('_id');
  if (!admins.length) return [];

  return Notification.insertMany(
    admins.map((admin) => ({
      userId: admin._id,
      title,
      message,
      type,
    })),
    { ordered: false }
  );
};

const notifyCourseUsers = async ({ courseId, title, message, type }) => {
  const users = await User.find({
    role: 'student',
    $or: [
      { enrolledCourses: courseId },
      { purchasedCourses: courseId },
    ],
  }).select('_id');

  if (!users.length) return [];

  return Notification.insertMany(
    users.map((user) => ({
      userId: user._id,
      title,
      message,
      type,
    })),
    { ordered: false }
  );
};

const notifyStudents = async ({ title, message, type }) => {
  const users = await User.find({ role: 'student' }).select('_id');
  if (!users.length) return [];

  return Notification.insertMany(
    users.map((user) => ({
      userId: user._id,
      title,
      message,
      type,
    })),
    { ordered: false }
  );
};

const safeNotify = async (job) => {
  try {
    return await job();
  } catch (error) {
    console.error('[notification] create failed:', error.message);
    return null;
  }
};

module.exports = {
  createNotification,
  notifyAdmins,
  notifyCourseUsers,
  notifyStudents,
  safeNotify,
};
