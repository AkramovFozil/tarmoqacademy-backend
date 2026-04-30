const Lesson = require('../models/Lesson');
const Module = require('../models/Module');
const Progress = require('../models/Progress');
const TaskSubmission = require('../models/TaskSubmission');
const { notifyCourseUsers, safeNotify } = require('../services/notificationService');
const {
  getPreviewLessonKey,
  isOfflineLessonAllowed,
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

const normalizeCloudflareVideoUid = (value = '') => {
  const uid = String(value || '').trim();
  if (!uid) return '';

  if (!/^[A-Za-z0-9_-]{6,128}$/.test(uid)) {
    throw new Error('Cloudflare Video UID noto\'g\'ri.');
  }

  return uid;
};

const buildCloudflareVideoUrl = (videoUid) => `https://iframe.videodelivery.net/${videoUid}`;

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
    const offlineAllowed = isOfflineLessonAllowed(req.user, lesson.moduleId.courseId, lesson._id);
    const previewLessonKey = hasFullAccess || offlineAllowed ? null : await getPreviewLessonKey(lesson.moduleId.courseId);
    const canAccessLesson = hasFullAccess || offlineAllowed || previewLessonKey === lesson._id.toString();

    if (!canAccessLesson) {
      return res.status(403).json({
        success: false,
        message: req.user.role === 'offline_student'
          ? 'Bu dars hali administrator tomonidan ochilmagan.'
          : 'Bu dars uchun ruxsat yo\'q.',
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
        videoProvider: lesson.videoProvider,
        videoUid: lesson.videoUid,
        videoUrl: lesson.videoUrl,
        videoType: lesson.videoType,
        videoStreamUrl: lesson.videoType === 'hls'
          ? `/api/videos/lessons/${lesson._id}/playback-url`
          : '',
        content: lesson.content,
        task: req.user.role === 'offline_student' ? '' : lesson.task,
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
    const { moduleId, title, videoUrl, videoUid, content, task, duration, order } = req.body || {};
    let normalizedVideoUrl = '';
    let normalizedVideoUid = '';

    try {
      normalizedVideoUid = normalizeCloudflareVideoUid(videoUid);
      normalizedVideoUrl = normalizedVideoUid
        ? buildCloudflareVideoUrl(normalizedVideoUid)
        : normalizeVideoUrl(videoUrl);
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
      videoProvider: normalizedVideoUid
        ? 'cloudflare'
        : (normalizedVideoUrl && /^https?:\/\//i.test(normalizedVideoUrl) ? 'external' : 'local'),
      videoUid: normalizedVideoUid,
      videoType: normalizedVideoUrl && /^https?:\/\//i.test(normalizedVideoUrl) ? 'external' : 'file',
      content,
      task,
      duration,
      order,
    });

    safeNotify(() => notifyCourseUsers({
      courseId: module.courseId,
      title: 'Yangi dars qo\'shildi',
      message: `"${lesson.title}" darsi qo'shildi.`,
      type: 'lesson_created',
    }));

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

    if (Object.prototype.hasOwnProperty.call(updatePayload, 'videoUid')) {
      try {
        const normalizedVideoUid = normalizeCloudflareVideoUid(updatePayload.videoUid);
        delete updatePayload.videoUid;

        if (normalizedVideoUid) {
          updatePayload.videoProvider = 'cloudflare';
          updatePayload.videoUid = normalizedVideoUid;
          updatePayload.videoUrl = buildCloudflareVideoUrl(normalizedVideoUid);
          updatePayload.videoType = 'external';
          updatePayload.hlsKey = '';
          updatePayload.hlsRenditions = [];
        }
      } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
      }
    }

    if (Object.prototype.hasOwnProperty.call(updatePayload, 'videoUrl')) {
      try {
        updatePayload.videoUrl = normalizeVideoUrl(updatePayload.videoUrl);
        if (!updatePayload.videoProvider || updatePayload.videoProvider !== 'cloudflare') {
          updatePayload.videoProvider = updatePayload.videoUrl && /^https?:\/\//i.test(updatePayload.videoUrl)
            ? 'external'
            : 'local';
          updatePayload.videoUid = '';
          updatePayload.videoType = updatePayload.videoUrl && /^https?:\/\//i.test(updatePayload.videoUrl)
            ? 'external'
            : 'file';
          updatePayload.hlsKey = '';
          updatePayload.hlsRenditions = [];
        }
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
