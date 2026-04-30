const Module = require('../models/Module');
const Lesson = require('../models/Lesson');

const isUserEnrolledInCourse = (user, courseId) => {
  if (!user) return false;
  if (user.role === 'admin') return true;

  return [...(user.enrolledCourses || []), ...(user.purchasedCourses || [])].some(
    (id) => id.toString() === courseId.toString()
  );
};

const isOfflineCourseActive = (user, courseId) => {
  if (!user || user.role !== 'offline_student') return false;
  if (user.offlineStatus && user.offlineStatus !== 'active') return false;
  const offlineCourseId = user.offlineAccess?.courseId;
  return Boolean(offlineCourseId && offlineCourseId.toString() === courseId.toString());
};

const isOfflineLessonAllowed = (user, courseId, lessonId) => {
  if (!isOfflineCourseActive(user, courseId)) return false;
  return (user.offlineAccess?.allowedLessons || []).some(
    (id) => id.toString() === lessonId.toString()
  );
};

const getPreviewLessonKey = async (courseId) => {
  const firstModule = await Module.findOne({ courseId }).sort({ order: 1 }).select('_id');
  if (!firstModule) return null;

  const firstLesson = await Lesson.findOne({ moduleId: firstModule._id }).sort({ order: 1 }).select('_id');
  return firstLesson ? firstLesson._id.toString() : null;
};

module.exports = {
  getPreviewLessonKey,
  isOfflineCourseActive,
  isOfflineLessonAllowed,
  isUserEnrolledInCourse,
};
