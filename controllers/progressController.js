const Progress = require('../models/Progress');
const UserProgress = require('../models/UserProgress');
const Lesson = require('../models/Lesson');
const Module = require('../models/Module');
const Course = require('../models/Course');
const User = require('../models/User');

const toDayKey = (date) => {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value.getTime();
};

const hasCourseAccess = (user, courseId) => {
  if (!user) return false;
  if (user.role === 'admin') return true;

  return [...(user.enrolledCourses || []), ...(user.purchasedCourses || [])].some(
    (id) => id.toString() === courseId.toString()
  );
};

const getCourseLessonContext = async (lessonId) => {
  const lesson = await Lesson.findById(lessonId).populate('moduleId');
  if (!lesson) return null;

  return {
    lesson,
    courseId: lesson.moduleId.courseId,
  };
};

// @desc    Mark a lesson as completed
// @route   POST /api/progress/complete
// @access  Private
const completeLesson = async (req, res) => {
  try {
    const { lessonId } = req.body;

    if (!lessonId) {
      return res
        .status(400)
        .json({ success: false, message: 'lessonId is required.' });
    }

    // Find the lesson and its module to get courseId
    const lessonContext = await getCourseLessonContext(lessonId);
    if (!lessonContext) {
      return res
        .status(404)
        .json({ success: false, message: 'Lesson not found.' });
    }

    const { lesson, courseId } = lessonContext;
    const user = await User.findById(req.user._id).select('role enrolledCourses purchasedCourses');

    if (!hasCourseAccess(user, courseId)) {
      return res.status(403).json({
        success: false,
        message: 'Bu kurs sizga ochilmagan.',
      });
    }

    // Upsert progress record
    const progress = await Progress.findOneAndUpdate(
      { userId: req.user._id, lessonId },
      { userId: req.user._id, lessonId, courseId, completed: true, completedAt: new Date() },
      { upsert: true, new: true }
    );

    await UserProgress.findOneAndUpdate(
      { userId: req.user._id, courseId },
      {
        $addToSet: { completedLessons: lesson._id },
        $set: {
          lastLessonId: lesson._id,
          lastViewedAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Calculate updated course progress
    const modules = await Module.find({ courseId });
    const moduleIds = modules.map((m) => m._id);
    const lessons = await Lesson.find({ moduleId: { $in: moduleIds } });
    const totalLessons = lessons.length;

    const lessonIds = lessons.map((l) => l._id);
    const completedCount = await Progress.countDocuments({
      userId: req.user._id,
      lessonId: { $in: lessonIds },
      completed: true,
    });

    const courseProgress = Math.round((completedCount / totalLessons) * 100);

    res.status(200).json({
      success: true,
      message: 'Lesson marked as completed.',
      lessonId,
      courseProgress,
      completedLessons: completedCount,
      totalLessons,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Mark a lesson as last viewed
// @route   POST /api/progress/view
// @access  Private
const markLessonViewed = async (req, res) => {
  try {
    const { lessonId } = req.body;

    if (!lessonId) {
      return res.status(400).json({
        success: false,
        message: 'lessonId is required.',
      });
    }

    const lessonContext = await getCourseLessonContext(lessonId);
    if (!lessonContext) {
      return res.status(404).json({
        success: false,
        message: 'Lesson not found.',
      });
    }

    const { lesson, courseId } = lessonContext;
    const user = await User.findById(req.user._id).select('role enrolledCourses purchasedCourses');

    if (!hasCourseAccess(user, courseId)) {
      return res.status(403).json({
        success: false,
        message: 'Bu kurs sizga ochilmagan.',
      });
    }

    const userProgress = await UserProgress.findOneAndUpdate(
      { userId: req.user._id, courseId },
      {
        $set: {
          lastLessonId: lesson._id,
          lastViewedAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(200).json({
      success: true,
      lastLessonId: userProgress.lastLessonId,
      lastViewedAt: userProgress.lastViewedAt,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get user dashboard stats
// @route   GET /api/progress/stats
// @access  Private
const getUserStats = async (req, res) => {
  try {
    // Total unique courses user has started
    const activeCourses = await Progress.distinct('courseId', {
      userId: req.user._id,
    });

    // Total completed lessons
    const totalCompleted = await Progress.countDocuments({
      userId: req.user._id,
      completed: true,
    });

    // Calculate overall progress across all active courses
    let courseDetails = [];
    for (const courseId of activeCourses) {
      const course = await Course.findById(courseId);
      if (!course) continue;

      const modules = await Module.find({ courseId });
      const moduleIds = modules.map((m) => m._id);
      const lessons = await Lesson.find({ moduleId: { $in: moduleIds } });
      const totalLessons = lessons.length;
      const lessonIds = lessons.map((l) => l._id);

      const completedCount = await Progress.countDocuments({
        userId: req.user._id,
        lessonId: { $in: lessonIds },
        completed: true,
      });

      courseDetails.push({
        courseId,
        title: course.title,
        progress: totalLessons > 0 ? Math.round((completedCount / totalLessons) * 100) : 0,
        completedLessons: completedCount,
        totalLessons,
      });
    }

    // Streak: count how many consecutive days user completed at least one lesson
    const recentProgress = await Progress.find({
      userId: req.user._id,
      completed: true,
    })
      .sort({ completedAt: -1 })
      .limit(100);

    const uniqueDays = Array.from(
      new Set(recentProgress.map((p) => toDayKey(p.completedAt)))
    ).sort((a, b) => b - a);

    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    let cursor = uniqueDays[0] === today.getTime() ? today : yesterday;

    for (const day of uniqueDays) {
      if (day !== cursor.getTime()) break;
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }

    res.status(200).json({
      success: true,
      stats: {
        activeCourses: activeCourses.length,
        totalCompleted,
        streak,
        courses: courseDetails,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get progress for a specific course
// @route   GET /api/progress/course/:courseId
// @access  Private
const getCourseProgress = async (req, res) => {
  try {
    const { courseId } = req.params;
    const user = await User.findById(req.user._id).select('role enrolledCourses purchasedCourses');

    if (!hasCourseAccess(user, courseId)) {
      return res.status(403).json({
        success: false,
        message: 'Bu kurs sizga ochilmagan.',
      });
    }

    const modules = await Module.find({ courseId });
    const moduleIds = modules.map((m) => m._id);
    const lessons = await Lesson.find({ moduleId: { $in: moduleIds } });
    const totalLessons = lessons.length;
    const lessonIds = lessons.map((l) => l._id);

    const completedLessons = await Progress.find({
      userId: req.user._id,
      lessonId: { $in: lessonIds },
      completed: true,
    }).select('lessonId completedAt');

    const completedIds = completedLessons.map((p) => p.lessonId.toString());
    const progress =
      totalLessons > 0
        ? Math.round((completedIds.length / totalLessons) * 100)
        : 0;

    res.status(200).json({
      success: true,
      courseId,
      progress,
      completedLessons: completedIds.length,
      totalLessons,
      completedLessonIds: completedIds,
      lastLessonId: null,
      lastViewedAt: null,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get progress for a specific course (UserProgress format)
// @route   GET /api/progress/:courseId
// @access  Private
const getUserProgressByCourse = async (req, res) => {
  try {
    const { courseId } = req.params;
    const user = await User.findById(req.user._id).select('role enrolledCourses purchasedCourses');

    if (!hasCourseAccess(user, courseId)) {
      return res.status(403).json({
        success: false,
        message: 'Bu kurs sizga ochilmagan.',
      });
    }

    const modules = await Module.find({ courseId }).select('_id');
    const moduleIds = modules.map((module) => module._id);
    const lessons = await Lesson.find({ moduleId: { $in: moduleIds } }).select('_id');
    const totalLessons = lessons.length;

    const lessonIds = lessons.map((lesson) => lesson._id.toString());

    const userProgress = await UserProgress.findOne({
      userId: req.user._id,
      courseId,
    }).select('completedLessons');

    const completedLessonIds = (userProgress?.completedLessons || [])
      .map((id) => id.toString())
      .filter((id) => lessonIds.includes(id));
    const progress =
      totalLessons > 0
        ? Math.round((completedLessonIds.length / totalLessons) * 100)
        : 0;

    res.status(200).json({
      success: true,
      courseId,
      progress,
      completedLessons: completedLessonIds,
      totalLessons,
      completedCount: completedLessonIds.length,
      lastLessonId: userProgress?.lastLessonId?.toString() || null,
      lastViewedAt: userProgress?.lastViewedAt || null,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { completeLesson, markLessonViewed, getUserStats, getCourseProgress, getUserProgressByCourse };
