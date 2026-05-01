const Progress = require('../models/Progress');
const UserProgress = require('../models/UserProgress');
const Lesson = require('../models/Lesson');
const Module = require('../models/Module');
const Course = require('../models/Course');
const User = require('../models/User');

const normalizeLegacyCount = (value) => {
  const numberValue = Number(value || 0);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.max(0, Math.floor(numberValue));
};

const getMaxCourseLessonCount = async () => {
  const courses = await Course.find().select('_id');
  if (!courses.length) return 0;

  const counts = await Promise.all(courses.map(async (course) => {
    const modules = await Module.find({ courseId: course._id }).select('_id');
    if (!modules.length) return 0;
    return Lesson.countDocuments({ moduleId: { $in: modules.map((module) => module._id) } });
  }));

  return Math.max(0, ...counts);
};

const getOrderedCourseLessons = async (courseId) => {
  const modules = await Module.find({ courseId }).sort({ order: 1 }).select('_id');
  const rows = [];

  for (const module of modules) {
    const lessons = await Lesson.find({ moduleId: module._id }).sort({ order: 1 }).select('_id');
    lessons.forEach((lesson) => rows.push(lesson));
  }

  return rows;
};

const getOnlineCourseIds = (user, requestedCourseId = null) => {
  if (!user || user.role === 'offline_student') return [];
  if (requestedCourseId) return [requestedCourseId];

  return [
    ...(user.enrolledCourses || []),
    ...(user.purchasedCourses || []),
  ].reduce((ids, id) => {
    const key = id?.toString();
    if (key && !ids.some((item) => item.toString() === key)) ids.push(id);
    return ids;
  }, []);
};

const rebuildUserProgressForCourse = async (userId, courseId, lessonIds) => {
  const completedRows = await Progress.find({
    userId,
    courseId,
    lessonId: { $in: lessonIds },
    completed: true,
  }).select('lessonId completedAt updatedAt');

  if (!completedRows.length) {
    await UserProgress.updateOne(
      { userId, courseId },
      { $set: { completedLessons: [], lastLessonId: null, lastViewedAt: null } }
    );
    return;
  }

  const latest = completedRows.reduce((winner, row) => {
    const winnerTime = new Date(winner.completedAt || winner.updatedAt || 0).getTime();
    const rowTime = new Date(row.completedAt || row.updatedAt || 0).getTime();
    return rowTime >= winnerTime ? row : winner;
  }, completedRows[0]);

  await UserProgress.findOneAndUpdate(
    { userId, courseId },
    {
      $set: {
        completedLessons: completedRows.map((row) => row.lessonId),
        lastLessonId: latest.lessonId,
        lastViewedAt: latest.completedAt || latest.updatedAt || new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

const syncLegacyProgressForUser = async (userOrId, options = {}) => {
  const user = typeof userOrId === 'object' && userOrId?._id
    && typeof userOrId.legacyUnlockedLessons !== 'undefined'
    && typeof userOrId.enrolledCourses !== 'undefined'
    ? userOrId
    : await User.findById(userOrId?._id || userOrId);

  if (!user || user.role === 'offline_student') {
    return { applied: false, skipped: true };
  }

  const legacyCount = normalizeLegacyCount(user.legacyUnlockedLessons);
  const courseIds = getOnlineCourseIds(user, options.courseId);

  if (!courseIds.length) {
    return { applied: false, skipped: true };
  }

  let changed = false;

  for (const courseId of courseIds) {
    const lessons = await getOrderedCourseLessons(courseId);
    const lessonIds = lessons.map((lesson) => lesson._id);
    const legacyLessonIds = lessonIds.slice(0, Math.min(legacyCount, lessonIds.length));
    const legacySet = new Set(legacyLessonIds.map((id) => id.toString()));
    const existingLegacyRows = await Progress.find({
      userId: user._id,
      courseId,
      legacyCompleted: true,
    }).select('lessonId');

    const legacyRowsToRemove = existingLegacyRows
      .filter((row) => !legacySet.has(row.lessonId.toString()))
      .map((row) => row.lessonId);

    if (legacyRowsToRemove.length) {
      await Progress.deleteMany({
        userId: user._id,
        courseId,
        lessonId: { $in: legacyRowsToRemove },
        legacyCompleted: true,
      });
      changed = true;
    }

    if (legacyLessonIds.length) {
      for (const lessonId of legacyLessonIds) {
        const existingProgress = await Progress.findOne({ userId: user._id, lessonId })
          .select('completed legacyCompleted');
        if (existingProgress?.completed && !existingProgress.legacyCompleted) {
          continue;
        }

        await Progress.findOneAndUpdate(
          { userId: user._id, lessonId },
          {
            $set: {
              userId: user._id,
              lessonId,
              courseId,
              completed: true,
              completedAt: new Date(),
              watchPercent: 100,
              status: 'completed',
              lastPosition: 0,
              duration: 0,
              legacyCompleted: true,
            },
          },
          { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
        );
      }
      changed = true;
    }

    await rebuildUserProgressForCourse(user._id, courseId, lessonIds);
  }

  if (!user.legacyApplied || changed) {
    user.legacyApplied = legacyCount > 0;
    await user.save();
  }

  return { applied: changed, skipped: false };
};

module.exports = {
  getMaxCourseLessonCount,
  getOrderedCourseLessons,
  normalizeLegacyCount,
  syncLegacyProgressForUser,
};
