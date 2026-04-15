const Course = require('../models/Course');
const Lesson = require('../models/Lesson');
const Module = require('../models/Module');
const Progress = require('../models/Progress');
const TaskSubmission = require('../models/TaskSubmission');
const User = require('../models/User');
const UserProgress = require('../models/UserProgress');

const hasFullCourseAccess = (user, courseId) => {
  if (!user) return false;
  if (user.role === 'admin') return true;

  return [...(user.enrolledCourses || []), ...(user.purchasedCourses || [])].some(
    (id) => id.toString() === courseId.toString()
  );
};

const getPreviewLessonId = async (courseId) => {
  const firstModule = await Module.findOne({ courseId }).sort({ order: 1 }).select('_id');
  if (!firstModule) return null;

  const firstLesson = await Lesson.findOne({ moduleId: firstModule._id }).sort({ order: 1 }).select('_id');
  return firstLesson?._id?.toString() || null;
};

const getLessonAccessContext = async (userId, lessonId) => {
  const lesson = await Lesson.findById(lessonId).populate('moduleId');
  if (!lesson) {
    return { error: { status: 404, message: 'Dars topilmadi.' } };
  }

  const [course, user] = await Promise.all([
    Course.findById(lesson.moduleId.courseId).select('title isPublished'),
    User.findById(userId).select('role enrolledCourses purchasedCourses'),
  ]);

  if (!course) {
    return { error: { status: 404, message: 'Kurs topilmadi.' } };
  }

  const fullAccess = hasFullCourseAccess(user, course._id);
  let previewAccess = false;

  if (!fullAccess && course.isPublished) {
    const previewLessonId = await getPreviewLessonId(course._id);
    previewAccess = previewLessonId === lesson._id.toString();
  }

  if (!fullAccess && !previewAccess) {
    return { error: { status: 403, message: 'Kursni sotib olish kerak.' } };
  }

  return { lesson, course, fullAccess, previewAccess };
};

const serializeSubmission = (submission) => {
  const lesson = submission.lessonId;
  const module = lesson?.moduleId;
  const course = module?.courseId;
  const user = submission.userId;
  const reviewer = submission.reviewedBy;

  return {
    id: submission._id,
    userId: user?._id || submission.userId,
    userName: user?.name || 'Talaba',
    userEmail: user?.email || '',
    courseId: course?._id || '',
    moduleId: module?._id || '',
    lessonId: lesson?._id || submission.lessonId,
    courseTitle: course?.title || '',
    moduleTitle: module?.title || '',
    lessonTitle: lesson?.title || 'Dars',
    answer: submission.answer,
    content: submission.answer,
    attachmentName: submission.attachmentName || '',
    attachmentSize: submission.attachmentSize || 0,
    status: submission.status || 'pending',
    submittedAt: submission.createdAt,
    updatedAt: submission.updatedAt,
    reviewedAt: submission.reviewedAt,
    reviewedBy: reviewer?.name || reviewer?.email || '',
    reviewNote: submission.reviewNote || '',
  };
};

const populateSubmissionQuery = (query) =>
  query
    .populate('userId', 'name email')
    .populate('reviewedBy', 'name email')
    .populate({
      path: 'lessonId',
      select: 'title moduleId',
      populate: {
        path: 'moduleId',
        select: 'title courseId',
        populate: {
          path: 'courseId',
          select: 'title',
        },
      },
    });

// @desc    Save or update lesson task answer
// @route   POST /api/tasks/submit
// @access  Private
const submitTaskAnswer = async (req, res) => {
  try {
    const { lessonId, answer, attachmentName, attachmentSize } = req.body;
    const normalizedAttachmentSize = Number(attachmentSize || 0);

    if (!lessonId || !String(answer || '').trim()) {
      return res.status(400).json({
        success: false,
        message: 'lessonId va answer majburiy.',
      });
    }

    const context = await getLessonAccessContext(req.user._id, lessonId);
    if (context.error) {
      return res.status(context.error.status).json({ success: false, message: context.error.message });
    }

    if (!context.lesson.task) {
      return res.status(400).json({
        success: false,
        message: 'Bu dars uchun topshiriq mavjud emas.',
      });
    }

    const submission = await TaskSubmission.findOneAndUpdate(
      { userId: req.user._id, lessonId },
      {
        userId: req.user._id,
        lessonId,
        answer: String(answer).trim(),
        attachmentName: String(attachmentName || '').trim(),
        attachmentSize: Number.isFinite(normalizedAttachmentSize) ? normalizedAttachmentSize : 0,
        status: 'pending',
        reviewedAt: null,
        reviewedBy: null,
        reviewNote: '',
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );

    await Promise.all([
      Progress.deleteOne({ userId: req.user._id, lessonId }),
      UserProgress.updateOne(
        { userId: req.user._id, courseId: context.course._id },
        { $pull: { completedLessons: context.lesson._id } }
      ),
    ]);

    return res.status(200).json({
      success: true,
      message: 'Topshiriq javobi saqlandi.',
      submission: {
        id: submission._id,
        lessonId: submission.lessonId,
        answer: submission.answer,
        content: submission.answer,
        attachmentName: submission.attachmentName || '',
        attachmentSize: submission.attachmentSize || 0,
        status: submission.status,
        reviewedAt: submission.reviewedAt,
        reviewedBy: '',
        reviewNote: submission.reviewNote || '',
        submittedAt: submission.createdAt,
        updatedAt: submission.updatedAt,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Admin: list submitted lesson tasks
// @route   GET /api/tasks/admin/submissions
// @access  Private/Admin
const listTaskSubmissions = async (req, res) => {
  try {
    const submissions = await populateSubmissionQuery(
      TaskSubmission.find().sort({ updatedAt: -1 })
    );

    return res.status(200).json({
      success: true,
      count: submissions.length,
      submissions: submissions.map(serializeSubmission),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Admin: approve or reject a task submission
// @route   PUT /api/tasks/admin/submissions/:id/review
// @access  Private/Admin
const reviewTaskSubmission = async (req, res) => {
  try {
    const { status, reviewNote } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'status approved yoki rejected bo\'lishi kerak.',
      });
    }

    const submission = await TaskSubmission.findById(req.params.id).populate({
      path: 'lessonId',
      select: 'moduleId',
      populate: {
        path: 'moduleId',
        select: 'courseId',
      },
    });

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Topshiriq topilmadi.',
      });
    }

    const lesson = submission.lessonId;
    const courseId = lesson?.moduleId?.courseId;

    if (!lesson || !courseId) {
      return res.status(400).json({
        success: false,
        message: 'Topshiriq bog\'langan dars yoki kurs topilmadi.',
      });
    }

    submission.status = status;
    submission.reviewedAt = new Date();
    submission.reviewedBy = req.user._id;
    submission.reviewNote = String(reviewNote || '').trim();
    await submission.save();

    if (status === 'approved') {
      await Progress.findOneAndUpdate(
        { userId: submission.userId, lessonId: lesson._id },
        {
          userId: submission.userId,
          lessonId: lesson._id,
          courseId,
          completed: true,
          completedAt: new Date(),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      await UserProgress.findOneAndUpdate(
        { userId: submission.userId, courseId },
        {
          $addToSet: { completedLessons: lesson._id },
          $set: {
            lastLessonId: lesson._id,
            lastViewedAt: new Date(),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } else {
      await Progress.deleteOne({ userId: submission.userId, lessonId: lesson._id });
      await UserProgress.updateOne(
        { userId: submission.userId, courseId },
        { $pull: { completedLessons: lesson._id } }
      );
    }

    const populated = await populateSubmissionQuery(TaskSubmission.findById(submission._id));

    return res.status(200).json({
      success: true,
      message: status === 'approved'
        ? 'Topshiriq tasdiqlandi.'
        : 'Topshiriq rad etildi.',
      submission: serializeSubmission(populated),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  submitTaskAnswer,
  listTaskSubmissions,
  reviewTaskSubmission,
};
