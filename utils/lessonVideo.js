const Module = require('../models/Module');
const Lesson = require('../models/Lesson');
const Progress = require('../models/Progress');

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

const getOrderedCourseLessons = async (courseId) => {
  const modules = await Module.find({ courseId }).sort({ order: 1 }).select('_id');
  const rows = [];

  for (const module of modules) {
    const lessons = await Lesson.find({ moduleId: module._id }).sort({ order: 1 }).select('_id');
    rows.push(...lessons);
  }

  return rows;
};

const getOfflineLessonAccess = async (user, courseId, lessonId) => {
  if (!isOfflineCourseActive(user, courseId)) {
    return { allowed: false, locked: true, message: 'Bu kurs offline hisobingiz uchun ochilmagan.' };
  }

  const allowedLessons = new Set((user.offlineAccess?.allowedLessons || []).map((id) => id.toString()));
  const targetLessonId = lessonId.toString();

  if (!allowedLessons.has(targetLessonId)) {
    return { allowed: false, locked: true, message: 'Bu dars hali administrator tomonidan ochilmagan.' };
  }

  const orderedLessons = await getOrderedCourseLessons(courseId);
  const targetIndex = orderedLessons.findIndex((lesson) => lesson._id.toString() === targetLessonId);
  const previousAllowedLesson = orderedLessons
    .slice(0, Math.max(targetIndex, 0))
    .reverse()
    .find((lesson) => allowedLessons.has(lesson._id.toString()));

  if (!previousAllowedLesson) {
    return { allowed: true, locked: false, message: '' };
  }

  const progress = await Progress.findOne({
    userId: user._id,
    lessonId: previousAllowedLesson._id,
  }).select('completed watchPercent status');

  if (progress?.completed || Number(progress?.watchPercent || 0) >= 85) {
    return { allowed: true, locked: false, message: '' };
  }

  return { allowed: true, locked: true, message: 'Avval joriy darsni yakunlang' };
};

const getPreviewLessonKey = async (courseId) => {
  const firstModule = await Module.findOne({ courseId }).sort({ order: 1 }).select('_id');
  if (!firstModule) return null;

  const firstLesson = await Lesson.findOne({ moduleId: firstModule._id }).sort({ order: 1 }).select('_id');
  return firstLesson ? firstLesson._id.toString() : null;
};

module.exports = {
  getPreviewLessonKey,
  getOfflineLessonAccess,
  getOrderedCourseLessons,
  isOfflineCourseActive,
  isOfflineLessonAllowed,
  isUserEnrolledInCourse,
};
