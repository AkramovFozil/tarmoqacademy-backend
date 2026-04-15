const jwt = require('jsonwebtoken');
const Module = require('../models/Module');
const Lesson = require('../models/Lesson');

const videoTokenExpiresIn = process.env.VIDEO_TOKEN_EXPIRES_IN || '4h';

const isLocalVideoPath = (videoUrl = '') => videoUrl.startsWith('videos/');

const isUserEnrolledInCourse = (user, courseId) => {
  if (!user) return false;
  if (user.role === 'admin') return true;

  return [...(user.enrolledCourses || []), ...(user.purchasedCourses || [])].some(
    (id) => id.toString() === courseId.toString()
  );
};

const getPreviewLessonKey = async (courseId) => {
  const firstModule = await Module.findOne({ courseId }).sort({ order: 1 }).select('_id');
  if (!firstModule) return null;

  const firstLesson = await Lesson.findOne({ moduleId: firstModule._id }).sort({ order: 1 }).select('_id');
  return firstLesson ? firstLesson._id.toString() : null;
};

const createLessonVideoToken = ({ userId, lessonId }) => jwt.sign(
  {
    sub: userId.toString(),
    lessonId: lessonId.toString(),
    purpose: 'lesson-video',
  },
  process.env.JWT_SECRET,
  { expiresIn: videoTokenExpiresIn }
);

const verifyLessonVideoToken = (token, lessonId) => {
  const payload = jwt.verify(token, process.env.JWT_SECRET);

  if (
    payload.purpose !== 'lesson-video'
    || payload.lessonId !== lessonId.toString()
    || !payload.sub
  ) {
    throw new Error('Invalid video token.');
  }

  return payload;
};

const buildLessonVideoStreamUrl = (lesson, userId) => {
  if (!lesson || !isLocalVideoPath(lesson.videoUrl)) return '';

  const token = createLessonVideoToken({
    userId,
    lessonId: lesson._id,
  });

  return `/api/lessons/${lesson._id}/video?token=${encodeURIComponent(token)}`;
};

module.exports = {
  buildLessonVideoStreamUrl,
  getPreviewLessonKey,
  isLocalVideoPath,
  isUserEnrolledInCourse,
  verifyLessonVideoToken,
};
