const User = require('../models/User');
const Course = require('../models/Course');
const Module = require('../models/Module');
const Lesson = require('../models/Lesson');
const Progress = require('../models/Progress');

// @desc    Get logged-in user's enrolled courses
// @route   GET /api/user/my-courses
const getMyCourses = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('role enrolledCourses purchasedCourses offlineStatus offlineAccess');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User topilmadi.' });
    }

    if (user.role === 'offline_student') {
      const courseId = user.offlineAccess?.courseId;
      if (!courseId) {
        return res.json({ success: true, courses: [] });
      }

      const course = await Course.findById(courseId);
      if (!course) {
        return res.json({ success: true, courses: [] });
      }

      const modules = await Module.find({ courseId: course._id }).select('_id');
      const moduleIds = modules.map((module) => module._id);
      const lessons = await Lesson.find({ moduleId: { $in: moduleIds } }).select('_id');
      const totalLessons = lessons.length;
      const allowedLessonIds = (user.offlineAccess?.allowedLessons || []).map((id) => id.toString());
      const allowedLessons = allowedLessonIds.length;
      const lessonIds = lessons.map((lesson) => lesson._id);
      const completedLessons = await Progress.countDocuments({
        userId: req.user._id,
        lessonId: { $in: lessonIds.filter((id) => allowedLessonIds.includes(id.toString())) },
        completed: true,
      });
      const progress = allowedLessons > 0
        ? Math.round((completedLessons / allowedLessons) * 100)
        : 0;

      return res.json({
        success: true,
        courses: [{
          id: course._id,
          title: course.title,
          description: course.description,
          image: course.image,
          price: 0,
          category: course.category,
          totalLessons,
          purchased: user.offlineStatus === 'active',
          offlineMode: true,
          offlineStatus: user.offlineStatus || 'active',
          allowedLessons,
          previewAvailable: false,
          progress,
          isCompleted: false,
        }],
      });
    }

    const purchasedIds = [
      ...(user.enrolledCourses || []),
      ...(user.purchasedCourses || []),
    ].map((id) => id.toString());

    const courses = await Course.find(
      user.role === 'admin'
        ? {}
        : { isPublished: true }
    ).sort({ createdAt: -1 });

    const coursesWithMeta = await Promise.all(
      courses.map(async (course) => {
        const modules = await Module.find({ courseId: course._id }).select('_id');
        const moduleIds = modules.map((module) => module._id);
        const lessons = await Lesson.find({ moduleId: { $in: moduleIds } }).select('_id');
        const lessonIds = lessons.map((lesson) => lesson._id);
        const totalLessons = lessonIds.length;
        const purchased = user.role === 'admin' || purchasedIds.includes(course._id.toString());
        const completedLessons = purchased
          ? await Progress.countDocuments({
              userId: req.user._id,
              lessonId: { $in: lessonIds },
              completed: true,
            })
          : 0;
        const progress =
          totalLessons > 0
            ? Math.round((completedLessons / totalLessons) * 100)
            : 0;

        return {
          id: course._id,
          title: course.title,
          description: course.description,
          image: course.image,
          price: course.price ?? 99000,
          category: course.category,
          totalLessons,
          purchased,
          previewAvailable: !purchased && totalLessons > 0,
          progress,
          isCompleted: progress === 100,
        };
      })
    );

    res.json({
      success: true,
      courses: coursesWithMeta,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Update logged-in user profile
// @route   PUT /api/users/profile
const updateProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('+password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Foydalanuvchi topilmadi.',
      });
    }

    const nextName = String(req.body.name || '').trim();
    const nextEmail = String(req.body.email || '').trim().toLowerCase();
    const nextPassword = String(req.body.password || '');

    if (!nextName || !nextEmail) {
      return res.status(400).json({
        success: false,
        message: 'Ism va email majburiy.',
      });
    }

    const existingUser = await User.findOne({
      email: nextEmail,
      _id: { $ne: user._id },
    }).select('_id');

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Bu email allaqachon boshqa foydalanuvchiga tegishli.',
      });
    }

    user.name = nextName;
    user.email = nextEmail;

    if (nextPassword) {
      if (nextPassword.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'Parol kamida 6 ta belgidan iborat bo\'lishi kerak.',
        });
      }

      user.password = nextPassword;
    }

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Profil muvaffaqiyatli yangilandi.',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

module.exports = { getMyCourses, updateProfile };
