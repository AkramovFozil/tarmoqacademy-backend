const Course = require('../models/Course');
const Module = require('../models/Module');
const Lesson = require('../models/Lesson');
const Progress = require('../models/Progress');
const Purchase = require('../models/Purchase');
const User = require('../models/User');
const UserProgress = require('../models/UserProgress');
const TaskSubmission = require('../models/TaskSubmission');
const { resolveCourseCategory } = require('./categoryController');

const isUserEnrolledInCourse = (user, courseId) => {
  if (!user) return false;
  if (user.role === 'admin') return true;

  return [...(user.enrolledCourses || []), ...(user.purchasedCourses || [])].some(
    (id) => id.toString() === courseId.toString()
  );
};

// Helper: calculate course progress for a user
const getCourseProgress = async (courseId, userId) => {
  const modules = await Module.find({ courseId });
  const moduleIds = modules.map((m) => m._id);

  const lessons = await Lesson.find({ moduleId: { $in: moduleIds } });
  const totalLessons = lessons.length;

  if (totalLessons === 0) return 0;

  const lessonIds = lessons.map((l) => l._id);
  const completedCount = await Progress.countDocuments({
    userId,
    lessonId: { $in: lessonIds },
    completed: true,
  });

  return Math.round((completedCount / totalLessons) * 100);
};

const getPreviewLessonKey = async (courseId) => {
  const firstModule = await Module.findOne({ courseId }).sort({ order: 1 }).select('_id');
  if (!firstModule) return null;

  const firstLesson = await Lesson.findOne({ moduleId: firstModule._id }).sort({ order: 1 }).select('_id');
  return firstLesson ? firstLesson._id.toString() : null;
};

// @desc    Get all courses with user progress
// @route   GET /api/courses
// @access  Private
const getCourses = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('role enrolledCourses purchasedCourses');
    const courses = await Course.find(
      user.role === 'admin'
        ? {}
        : {
            isPublished: true,
          }
    ).sort({
      createdAt: -1,
    });

    const coursesWithProgress = await Promise.all(
      courses.map(async (course) => {
        const progress = await getCourseProgress(course._id, req.user._id);

        const modules = await Module.find({ courseId: course._id });
        const moduleIds = modules.map((m) => m._id);
        const totalLessons = await Lesson.countDocuments({
          moduleId: { $in: moduleIds },
        });

        return {
          id: course._id,
          title: course.title,
          description: course.description,
          image: course.image,
          price: course.price ?? 99000,
          category: course.category,
          totalLessons,
          progress: isUserEnrolledInCourse(user, course._id) ? progress : 0,
          purchased: isUserEnrolledInCourse(user, course._id),
          previewAvailable: totalLessons > 0,
          isCompleted: progress === 100,
        };
      })
    );

    res.status(200).json({
      success: true,
      count: coursesWithProgress.length,
      courses: coursesWithProgress,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get single course with modules and lessons
// @route   GET /api/courses/:id
// @access  Private
const getCourseById = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) {
      return res
        .status(404)
        .json({ success: false, message: 'Course not found.' });
    }

    const user = await User.findById(req.user._id).select('role enrolledCourses purchasedCourses');
    const hasFullAccess = isUserEnrolledInCourse(user, course._id);
    if (!hasFullAccess && !course.isPublished) {
      return res.status(404).json({
        success: false,
        message: 'Kurs topilmadi.',
      });
    }

    const modules = await Module.find({ courseId: course._id }).sort({
      order: 1,
    });
    const userProgress = hasFullAccess
      ? await UserProgress.findOne({ userId: req.user._id, courseId: course._id }).select(
          'completedLessons lastLessonId lastViewedAt'
        )
      : null;
    const completedLessonIds = new Set((userProgress?.completedLessons || []).map((id) => id.toString()));
    const courseLessonDocs = await Lesson.find({ moduleId: { $in: modules.map((module) => module._id) } }).select('_id');
    const taskSubmissions = await TaskSubmission.find({
      userId: req.user._id,
      lessonId: { $in: courseLessonDocs.map((lesson) => lesson._id) },
    })
      .select('lessonId answer attachmentName attachmentSize status reviewedAt reviewedBy reviewNote createdAt updatedAt')
      .populate('reviewedBy', 'name email');
    const taskSubmissionMap = new Map(
      taskSubmissions.map((submission) => [
        submission.lessonId.toString(),
        submission,
      ])
    );
    const previewLessonKey = hasFullAccess ? null : await getPreviewLessonKey(course._id);
    const modulesWithLessons = [];
    let totalLessons = 0;

    for (const module of modules) {
      const lessons = await Lesson.find({ moduleId: module._id }).sort({ order: 1 });
      const lessonsWithProgress = [];

      for (const lesson of lessons) {
        totalLessons += 1;
        const isPreviewLesson = !hasFullAccess && previewLessonKey === lesson._id.toString();
        const taskSubmission = taskSubmissionMap.get(lesson._id.toString());

        lessonsWithProgress.push({
          id: lesson._id,
          title: lesson.title,
          videoUrl: hasFullAccess || isPreviewLesson ? lesson.videoUrl : '',
          content: hasFullAccess || isPreviewLesson ? lesson.content : '',
          task: hasFullAccess || isPreviewLesson ? lesson.task : '',
          duration: lesson.duration,
          order: lesson.order,
          completed: hasFullAccess ? completedLessonIds.has(lesson._id.toString()) : false,
          locked: !hasFullAccess && !isPreviewLesson,
          previewAccessible: isPreviewLesson,
          taskAnswer: hasFullAccess || isPreviewLesson ? taskSubmission?.answer || '' : '',
          taskAnsweredAt: hasFullAccess || isPreviewLesson ? taskSubmission?.updatedAt || null : null,
          taskAttachmentName: hasFullAccess || isPreviewLesson ? taskSubmission?.attachmentName || '' : '',
          taskAttachmentSize: hasFullAccess || isPreviewLesson ? taskSubmission?.attachmentSize || 0 : 0,
          submissionId: hasFullAccess || isPreviewLesson ? taskSubmission?._id || '' : '',
          submissionStatus: hasFullAccess || isPreviewLesson
            ? taskSubmission?.status || (taskSubmission ? 'pending' : null)
            : null,
          reviewedAt: hasFullAccess || isPreviewLesson ? taskSubmission?.reviewedAt || null : null,
          reviewedBy: hasFullAccess || isPreviewLesson
            ? taskSubmission?.reviewedBy?.name || taskSubmission?.reviewedBy?.email || ''
            : '',
          reviewNote: hasFullAccess || isPreviewLesson ? taskSubmission?.reviewNote || '' : '',
        });
      }

      modulesWithLessons.push({
        id: module._id,
        title: module.title,
        order: module.order,
        lessons: lessonsWithProgress,
      });
    }

    const progress = hasFullAccess ? await getCourseProgress(course._id, req.user._id) : 0;

    res.status(200).json({
      success: true,
      course: {
        id: course._id,
        title: course.title,
        description: course.description,
        image: course.image,
        price: course.price ?? 99000,
        category: course.category,
        isPublished: course.isPublished,
        purchased: hasFullAccess,
        previewMode: !hasFullAccess,
        progress,
        totalLessons,
        completedLessonsCount: hasFullAccess ? completedLessonIds.size : 0,
        lastLessonId: hasFullAccess ? userProgress?.lastLessonId?.toString() || null : null,
        lastViewedAt: hasFullAccess ? userProgress?.lastViewedAt || null : null,
        modules: modulesWithLessons,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create a new course (Admin only)
// @route   POST /api/courses
// @access  Private/Admin
const createCourse = async (req, res) => {
  try {
    const { title, description, image, category, categoryId, price, isPublished } = req.body;
    const resolvedCategory = await resolveCourseCategory({ categoryId, category, fallbackToDefault: true });

    const course = await Course.create({
      title,
      description,
      image,
      category: resolvedCategory?.name || category || 'Programming',
      categoryId: resolvedCategory?._id || null,
      price: Number.isFinite(Number(price)) ? Math.max(0, Number(price)) : undefined,
      isPublished:
        typeof isPublished === 'undefined'
          ? undefined
          : isPublished === true || isPublished === 'true' || isPublished === 1 || isPublished === '1',
      instructor: req.user._id,
    });

    res.status(201).json({
      success: true,
      message: 'Course created successfully.',
      course,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update a course (Admin only)
// @route   PUT /api/courses/:id
// @access  Private/Admin
const updateCourse = async (req, res) => {
  try {
    const updatePayload = { ...req.body };
    const resolvedCategory = await resolveCourseCategory({
      categoryId: req.body.categoryId,
      category: req.body.category,
      fallbackToDefault: false,
    });

    if (resolvedCategory) {
      updatePayload.category = resolvedCategory.name;
      updatePayload.categoryId = resolvedCategory._id;
    }

    const course = await Course.findByIdAndUpdate(req.params.id, updatePayload, {
      new: true,
      runValidators: true,
    });

    if (!course) {
      return res
        .status(404)
        .json({ success: false, message: 'Course not found.' });
    }

    res.status(200).json({ success: true, course });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Delete a course (Admin only)
// @route   DELETE /api/courses/:id
// @access  Private/Admin
const deleteCourse = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) {
      return res
        .status(404)
        .json({ success: false, message: 'Course not found.' });
    }

    const modules = await Module.find({ courseId: course._id }).select('_id');
    const moduleIds = modules.map((module) => module._id);
    const lessons = await Lesson.find({ moduleId: { $in: moduleIds } }).select('_id');
    const lessonIds = lessons.map((lesson) => lesson._id);

    await Progress.deleteMany({ lessonId: { $in: lessonIds } });
    await UserProgress.deleteMany({ courseId: course._id });
    await TaskSubmission.deleteMany({ lessonId: { $in: lessonIds } });
    await Lesson.deleteMany({ moduleId: { $in: moduleIds } });
    await Module.deleteMany({ courseId: course._id });
    await User.updateMany(
      { enrolledCourses: course._id },
      { $pull: { enrolledCourses: course._id } }
    );
    await User.updateMany(
      { purchasedCourses: course._id },
      { $pull: { purchasedCourses: course._id } }
    );
    await Purchase.deleteMany({ courseId: course._id });
    await course.deleteOne();

    res
      .status(200)
      .json({ success: true, message: 'Course deleted successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getCourses,
  getCourseById,
  createCourse,
  updateCourse,
  deleteCourse,
};
