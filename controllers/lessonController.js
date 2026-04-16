const Lesson = require('../models/Lesson');
const Module = require('../models/Module');
const Progress = require('../models/Progress');
const TaskSubmission = require('../models/TaskSubmission');
const {
  getPreviewLessonKey,
  isUserEnrolledInCourse,
} = require('../utils/lessonVideo');

const normalizeVideoUrl = (value = '') => {
  const rawUrl = String(value || '').trim();
  if (!rawUrl) return '';

  if (/^https?:\/\//i.test(rawUrl)) {
    try {
      const url = new URL(rawUrl);
      return url.toString();
    } catch {
      throw new Error('Video URL noto\'g\'ri.');
    }
  }

  const normalizedSlashes = rawUrl.replace(/\\/g, '/');
  let localPath = normalizedSlashes;

  if (localPath.startsWith('/uploads/')) {
    localPath = localPath;
  } else if (localPath.startsWith('uploads/')) {
    localPath = `/${localPath}`;
  } else if (localPath.startsWith('videos/')) {
    localPath = `/uploads/${localPath}`;
  } else if (!localPath.startsWith('/')) {
    localPath = `/uploads/${localPath}`;
  } else {
    throw new Error('Video URL /uploads/filename.mp4 ko\'rinishida bo\'lishi kerak.');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(localPath, 'https://api.tarmoqacademy.uz');
  } catch {
    throw new Error('Video URL noto\'g\'ri.');
  }

  const decodedPath = decodeURIComponent(parsedUrl.pathname);
  if (
    !parsedUrl.pathname.startsWith('/uploads/')
    || parsedUrl.search
    || parsedUrl.hash
    || decodedPath.includes('\0')
    || decodedPath.split('/').includes('..')
  ) {
    throw new Error('Video URL /uploads/filename.mp4 ko\'rinishida bo\'lishi kerak.');
  }

  return parsedUrl.pathname;
};

// @desc    Get a single lesson with next/prev navigation
// @route   GET /api/lessons/:id
// @access  Private
const getLessonById = async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.id).populate('moduleId');
    if (!lesson) {
      return res
        .status(404)
        .json({ success: false, message: 'Lesson not found.' });
    }

    const hasFullAccess = isUserEnrolledInCourse(req.user, lesson.moduleId.courseId);
    const previewLessonKey = hasFullAccess ? null : await getPreviewLessonKey(lesson.moduleId.courseId);
    const canAccessLesson = hasFullAccess || previewLessonKey === lesson._id.toString();

    if (!canAccessLesson) {
      return res.status(403).json({
        success: false,
        message: 'Bu dars uchun ruxsat yo\'q.',
      });
    }

    // Check if lesson is completed by this user
    const progressRecord = await Progress.findOne({
      userId: req.user._id,
      lessonId: lesson._id,
    });

    // Find next lesson (same module, next order)
    let nextLesson = await Lesson.findOne({
      moduleId: lesson.moduleId._id,
      order: lesson.order + 1,
    });

    // If no next lesson in module, find first lesson of next module
    if (!nextLesson) {
      const nextModule = await Module.findOne({
        courseId: lesson.moduleId.courseId,
        order: lesson.moduleId.order + 1,
      });
      if (nextModule) {
        nextLesson = await Lesson.findOne({
          moduleId: nextModule._id,
          order: 1,
        });
      }
    }

    // Find previous lesson
    let prevLesson = await Lesson.findOne({
      moduleId: lesson.moduleId._id,
      order: lesson.order - 1,
    });

    if (!prevLesson) {
      const prevModule = await Module.findOne({
        courseId: lesson.moduleId.courseId,
        order: lesson.moduleId.order - 1,
      });

      if (prevModule) {
        prevLesson = await Lesson.findOne({
          moduleId: prevModule._id,
        }).sort({ order: -1 });
      }
    }

    res.status(200).json({
      success: true,
      lesson: {
        id: lesson._id,
        title: lesson.title,
        videoUrl: lesson.videoUrl,
        videoStreamUrl: '',
        content: lesson.content,
        task: lesson.task,
        duration: lesson.duration,
        order: lesson.order,
        moduleId: lesson.moduleId._id,
        moduleTitle: lesson.moduleId.title,
        completed: progressRecord ? progressRecord.completed : false,
      },
      navigation: {
        nextLessonId: nextLesson ? nextLesson._id : null,
        prevLessonId: prevLesson ? prevLesson._id : null,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create a lesson (Admin only)
// @route   POST /api/lessons
// @access  Private/Admin
const createLesson = async (req, res) => {
  try {
    const { moduleId, title, videoUrl, content, task, duration, order } = req.body || {};
    let normalizedVideoUrl;

    try {
      normalizedVideoUrl = normalizeVideoUrl(videoUrl);
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }

    const module = await Module.findById(moduleId);
    if (!module) {
      return res
        .status(404)
        .json({ success: false, message: 'Module not found.' });
    }

    const lesson = await Lesson.create({
      moduleId,
      title,
      videoUrl: normalizedVideoUrl,
      content,
      task,
      duration,
      order,
    });

    res.status(201).json({
      success: true,
      message: 'Lesson created successfully.',
      lesson,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update a lesson (Admin only)
// @route   PUT /api/lessons/:id
// @access  Private/Admin
const updateLesson = async (req, res) => {
  try {
    const updatePayload = { ...(req.body || {}) };

    if (Object.prototype.hasOwnProperty.call(updatePayload, 'videoUrl')) {
      try {
        updatePayload.videoUrl = normalizeVideoUrl(updatePayload.videoUrl);
      } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
      }
    }

    if (updatePayload.moduleId) {
      const module = await Module.findById(updatePayload.moduleId);
      if (!module) {
        return res
          .status(404)
          .json({ success: false, message: 'Module not found.' });
      }
    }

    const lesson = await Lesson.findByIdAndUpdate(req.params.id, updatePayload, {
      new: true,
      runValidators: true,
    });

    if (!lesson) {
      return res
        .status(404)
        .json({ success: false, message: 'Lesson not found.' });
    }

    res.status(200).json({ success: true, lesson });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Delete a lesson (Admin only)
// @route   DELETE /api/lessons/:id
// @access  Private/Admin
const deleteLesson = async (req, res) => {
  try {
    const lesson = await Lesson.findByIdAndDelete(req.params.id);
    if (!lesson) {
      return res
        .status(404)
        .json({ success: false, message: 'Lesson not found.' });
    }

    await Progress.deleteMany({ lessonId: lesson._id });
    await TaskSubmission.deleteMany({ lessonId: lesson._id });

    res
      .status(200)
      .json({ success: true, message: 'Lesson deleted successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getLessonById, createLesson, updateLesson, deleteLesson };
