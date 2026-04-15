const fs = require('fs');
const path = require('path');
const Lesson = require('../models/Lesson');
const Module = require('../models/Module');
const Progress = require('../models/Progress');
const TaskSubmission = require('../models/TaskSubmission');
const User = require('../models/User');
const {
  buildLessonVideoStreamUrl,
  getPreviewLessonKey,
  isLocalVideoPath,
  isUserEnrolledInCourse,
  verifyLessonVideoToken,
} = require('../utils/lessonVideo');

const buildVideoPath = (file) => {
  if (!file) return '';
  return `videos/${file.filename}`;
};

const videoContentTypes = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
};

const getVideoContentType = (filePath) => (
  videoContentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
);

const getBearerToken = (req) => {
  if (req.query.token) return req.query.token;

  const authorization = req.headers.authorization || '';
  if (authorization.startsWith('Bearer ')) {
    return authorization.split(' ')[1];
  }

  return '';
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
        videoStreamUrl: buildLessonVideoStreamUrl(lesson, req.user._id),
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

// @desc    Stream a protected lesson video
// @route   GET /api/lessons/:id/video
// @access  Signed video token
const streamLessonVideo = async (req, res) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ success: false, message: 'Video token required.' });
    }

    const payload = verifyLessonVideoToken(token, req.params.id);
    const [lesson, user] = await Promise.all([
      Lesson.findById(req.params.id),
      User.findById(payload.sub).select('role enrolledCourses purchasedCourses'),
    ]);

    if (!lesson || !user) {
      return res.status(404).json({ success: false, message: 'Video topilmadi.' });
    }

    if (!isLocalVideoPath(lesson.videoUrl)) {
      return res.status(404).json({ success: false, message: 'Bu darsda lokal video yo\'q.' });
    }

    const module = await Module.findById(lesson.moduleId).select('courseId');
    if (!module) {
      return res.status(404).json({ success: false, message: 'Modul topilmadi.' });
    }

    const hasFullAccess = isUserEnrolledInCourse(user, module.courseId);
    const previewLessonKey = hasFullAccess ? null : await getPreviewLessonKey(module.courseId);
    const canAccessVideo = hasFullAccess || previewLessonKey === lesson._id.toString();

    if (!canAccessVideo) {
      return res.status(403).json({ success: false, message: 'Bu video uchun ruxsat yo\'q.' });
    }

    const uploadsRoot = path.resolve(__dirname, '..', 'uploads');
    const videoPath = path.resolve(uploadsRoot, lesson.videoUrl);
    if (!videoPath.startsWith(`${uploadsRoot}${path.sep}`)) {
      return res.status(400).json({ success: false, message: 'Video yo\'li noto\'g\'ri.' });
    }

    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ success: false, message: 'Video fayl topilmadi.' });
    }

    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const contentType = getVideoContentType(videoPath);
    const range = req.headers.range;
    const baseHeaders = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store, private',
      'Content-Type': contentType,
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    };

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = Number.parseInt(parts[0], 10);
      const end = parts[1] ? Number.parseInt(parts[1], 10) : fileSize - 1;

      if (
        Number.isNaN(start)
        || Number.isNaN(end)
        || start >= fileSize
        || end >= fileSize
        || start > end
      ) {
        res.writeHead(416, {
          ...baseHeaders,
          'Content-Range': `bytes */${fileSize}`,
        });
        return res.end();
      }

      const chunkSize = end - start + 1;
      res.writeHead(206, {
        ...baseHeaders,
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Content-Length': chunkSize,
      });

      return fs.createReadStream(videoPath, { start, end }).pipe(res);
    }

    res.writeHead(200, {
      ...baseHeaders,
      'Content-Length': fileSize,
    });
    return fs.createReadStream(videoPath).pipe(res);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Video token muddati tugagan.' });
    }

    if (error.name === 'JsonWebTokenError' || error.message === 'Invalid video token.') {
      return res.status(401).json({ success: false, message: 'Video token noto\'g\'ri.' });
    }

    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create a lesson (Admin only)
// @route   POST /api/lessons
// @access  Private/Admin
const createLesson = async (req, res) => {
  try {
    const { moduleId, title, videoUrl, content, task, duration, order } = req.body;

    const module = await Module.findById(moduleId);
    if (!module) {
      return res
        .status(404)
        .json({ success: false, message: 'Module not found.' });
    }

    const lesson = await Lesson.create({
      moduleId,
      title,
      videoUrl: req.file ? buildVideoPath(req.file) : (videoUrl || ''),
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
    const updatePayload = { ...req.body };

    if (req.file) {
      updatePayload.videoUrl = buildVideoPath(req.file);
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

module.exports = { getLessonById, streamLessonVideo, createLesson, updateLesson, deleteLesson };
