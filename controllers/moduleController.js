const Module = require('../models/Module');
const Course = require('../models/Course');
const Lesson = require('../models/Lesson');
const Progress = require('../models/Progress');
const UserProgress = require('../models/UserProgress');
const TaskSubmission = require('../models/TaskSubmission');

// @desc    Get modules
// @route   GET /api/modules
// @access  Private
const getModules = async (req, res) => {
  try {
    const query = req.query.courseId ? { courseId: req.query.courseId } : {};
    const modules = await Module.find(query)
      .populate('courseId', 'title')
      .sort({ courseId: 1, order: 1, createdAt: 1 });

    const modulesWithCounts = await Promise.all(
      modules.map(async (module) => ({
        id: module._id,
        title: module.title,
        order: module.order,
        courseId: module.courseId?._id || module.courseId,
        courseTitle: module.courseId?.title || '',
        lessonCount: await Lesson.countDocuments({ moduleId: module._id }),
        createdAt: module.createdAt,
      }))
    );

    return res.status(200).json({
      success: true,
      count: modules.length,
      modules: modulesWithCounts,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create a module (Admin only)
// @route   POST /api/modules
// @access  Private/Admin
const createModule = async (req, res) => {
  try {
    const { courseId, title, order } = req.body;

    const course = await Course.findById(courseId);
    if (!course) {
      return res
        .status(404)
        .json({ success: false, message: 'Course not found.' });
    }

    const module = await Module.create({ courseId, title, order });

    res.status(201).json({
      success: true,
      message: 'Module created successfully.',
      module,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Update a module (Admin only)
// @route   PUT /api/modules/:id
// @access  Private/Admin
const updateModule = async (req, res) => {
  try {
    const module = await Module.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!module) {
      return res
        .status(404)
        .json({ success: false, message: 'Module not found.' });
    }

    res.status(200).json({ success: true, module });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Delete a module (Admin only)
// @route   DELETE /api/modules/:id
// @access  Private/Admin
const deleteModule = async (req, res) => {
  try {
    const module = await Module.findById(req.params.id);
    if (!module) {
      return res
        .status(404)
        .json({ success: false, message: 'Module not found.' });
    }

    const lessons = await Lesson.find({ moduleId: module._id }).select('_id');
    const lessonIds = lessons.map((lesson) => lesson._id);

    if (lessonIds.length) {
      await Progress.deleteMany({ lessonId: { $in: lessonIds } });
      await TaskSubmission.deleteMany({ lessonId: { $in: lessonIds } });
      await UserProgress.updateMany(
        { completedLessons: { $in: lessonIds } },
        { $pull: { completedLessons: { $in: lessonIds } } }
      );
      await UserProgress.updateMany(
        { lastLessonId: { $in: lessonIds } },
        { $set: { lastLessonId: null } }
      );
      await Lesson.deleteMany({ moduleId: module._id });
    }

    await module.deleteOne();

    res
      .status(200)
      .json({ success: true, message: 'Module deleted successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getModules, createModule, updateModule, deleteModule };
