const mongoose = require('mongoose');
const User = require('../models/User');
const Course = require('../models/Course');
const Module = require('../models/Module');
const Lesson = require('../models/Lesson');
const Progress = require('../models/Progress');
const Certificate = require('../models/Certificate');
const Purchase = require('../models/Purchase');
const UserProgress = require('../models/UserProgress');
const TaskSubmission = require('../models/TaskSubmission');
const { resolveCourseCategory } = require('./categoryController');
const { notifyStudents, safeNotify } = require('../services/notificationService');

const normalizePrice = (rawValue, fallback = 99000) => {
  const value = Number(rawValue);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : fallback;
};

const normalizePublished = (rawValue, fallback = true) => {
  if (typeof rawValue === 'undefined' || rawValue === null || rawValue === '') {
    return fallback;
  }

  return rawValue === true || rawValue === 'true' || rawValue === 1 || rawValue === '1';
};

const buildUploadPath = (file) => {
  if (!file) return '';
  const folder =
    file.mimetype.startsWith('image/')
      ? 'images'
      : file.mimetype === 'application/pdf'
        ? 'certificates'
        : 'videos';
  return `${folder}/${file.filename}`;
};

const ACTIVE_ACTIVITY_DAYS = 14;

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));
const OFFLINE_EMAIL_DOMAIN = 'offline.tarmoq.local';

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeOfflineStatus = (status, fallback = 'active') => (
  ['active', 'frozen', 'completed'].includes(status) ? status : fallback
);

const offlineStatusLabel = (status) => ({
  active: 'Aktiv',
  frozen: 'Muzlatilgan',
  completed: 'Tugagan',
}[status] || 'Aktiv');

const buildOfflineEmail = (login) => (
  login.includes('@') ? login : `${login}@${OFFLINE_EMAIL_DOMAIN}`
);

const serializeOfflineStudent = (user, course = null, totalLessons = 0) => ({
  id: user._id,
  name: user.name,
  phone: user.phone || '',
  login: user.offlineLogin || user.email,
  passwordMask: '********',
  courseId: user.offlineAccess?.courseId || '',
  courseTitle: course?.title || '',
  status: user.offlineStatus || 'active',
  statusLabel: offlineStatusLabel(user.offlineStatus || 'active'),
  note: user.offlineNote || '',
  createdAt: user.createdAt,
  allowedLessonsCount: (user.offlineAccess?.allowedLessons || []).length,
  totalLessons,
});

const normalizePaymentStatus = (status, fallback = 'paid') => {
  return status === 'pending' || status === 'paid' ? status : fallback;
};

const getCourseLessonIds = async (courseId) => {
  const modules = await Module.find({ courseId }).select('_id');
  const moduleIds = modules.map((module) => module._id);
  const lessons = await Lesson.find({ moduleId: { $in: moduleIds } }).select('_id');
  return lessons.map((lesson) => lesson._id);
};

const getCourseLessonsDetailed = async (courseId) => {
  const modules = await Module.find({ courseId }).sort({ order: 1 }).select('_id title order');
  const rows = [];

  for (const module of modules) {
    const lessons = await Lesson.find({ moduleId: module._id }).sort({ order: 1 }).select('_id title order duration');
    lessons.forEach((lesson) => {
      rows.push({
        id: lesson._id,
        title: lesson.title,
        order: lesson.order,
        duration: lesson.duration,
        moduleId: module._id,
        moduleTitle: module.title,
        moduleOrder: module.order,
      });
    });
  }

  return rows;
};

const syncManualCourseAccess = async ({ user, course, paymentStatus }) => {
  const status = normalizePaymentStatus(paymentStatus, 'paid');
  user.enrolledCourses = user.enrolledCourses || [];
  user.purchasedCourses = user.purchasedCourses || [];
  const hasEnrollment = user.enrolledCourses.some((id) => id.toString() === course._id.toString());
  const hasPurchaseAccess = user.purchasedCourses.some((id) => id.toString() === course._id.toString());

  if (!hasEnrollment) user.enrolledCourses.push(course._id);
  if (status === 'paid' && !hasPurchaseAccess) user.purchasedCourses.push(course._id);
  if (status === 'pending' && hasPurchaseAccess) {
    user.purchasedCourses = user.purchasedCourses.filter((id) => id.toString() !== course._id.toString());
  }

  await user.save();

  const purchaseUpdate = {
    userId: user._id,
    courseId: course._id,
    amount: Number(course.price) >= 0 ? Number(course.price) : 0,
    status,
    paidAt: status === 'paid' ? new Date() : null,
  };

  await Purchase.findOneAndUpdate(
    { userId: user._id, courseId: course._id },
    purchaseUpdate,
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
  );
};

const buildCourseUserRow = async ({ user, courseId, purchase, totalLessons, lessonIds }) => {
  const [progressDoc, completedCount] = await Promise.all([
    UserProgress.findOne({ userId: user._id, courseId }).select('lastViewedAt updatedAt completedLessons'),
    Progress.countDocuments({
      userId: user._id,
      courseId,
      lessonId: { $in: lessonIds },
      completed: true,
    }),
  ]);

  const completedFromUserProgress = (progressDoc?.completedLessons || [])
    .map((id) => id.toString())
    .filter((id) => lessonIds.some((lessonId) => lessonId.toString() === id)).length;
  const completedLessons = Math.max(completedCount, completedFromUserProgress);
  const progress = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;
  const addedAt = purchase?.createdAt || user.createdAt;
  const lastActivity = progressDoc?.lastViewedAt || progressDoc?.updatedAt || purchase?.paidAt || purchase?.updatedAt || null;
  const activeSince = new Date(Date.now() - ACTIVE_ACTIVITY_DAYS * 24 * 60 * 60 * 1000);
  const isActive = Boolean(lastActivity && new Date(lastActivity) >= activeSince);

  return {
    userId: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone || '',
    addedAt,
    paymentStatus: purchase?.status || 'manual',
    progress,
    completedLessons,
    totalLessons,
    lastActivity,
    activityStatus: isActive ? 'active' : 'inactive',
  };
};

// ─── USERS ────────────────────────────────────────────────────────────────────

// @desc    Get all users
// @route   GET /api/admin/users
const getUsers = async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 }).select('-password');
    res.json({ success: true, count: users.length, users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Create user
// @route   POST /api/admin/users
const createUser = async (req, res) => {
  try {
    const { name, email, password, role, phone } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'name, email va password majburiy.' });
    }

    const exists = await User.findOne({ email });
    if (exists) {
      return res.status(400).json({ success: false, message: 'Bu email allaqachon ro\'yxatdan o\'tgan.' });
    }

    const user = await User.create({
      name,
      email,
      password,
      phone: phone || '',
      role: role === 'admin' ? 'admin' : 'student',
    });

    res.status(201).json({
      success: true,
      message: 'Foydalanuvchi yaratildi.',
      user: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role, createdAt: user.createdAt },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Update user profile fields from admin
// @route   PUT /api/admin/users/:id
const updateUser = async (req, res) => {
  try {
    const { name, email, phone, role } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'Foydalanuvchi topilmadi.' });

    if (email && email !== user.email) {
      const exists = await User.findOne({ email, _id: { $ne: user._id } });
      if (exists) {
        return res.status(400).json({ success: false, message: 'Bu email boshqa foydalanuvchida mavjud.' });
      }
      user.email = email;
    }

    if (name) user.name = name;
    if (typeof phone !== 'undefined') user.phone = phone;
    if (role && (role === 'student' || role === 'admin')) user.role = role;

    await user.save();
    res.json({
      success: true,
      message: 'Foydalanuvchi yangilandi.',
      user: { id: user._id, name: user.name, email: user.email, phone: user.phone, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Delete user
// @route   DELETE /api/admin/users/:id
const deleteUser = async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'O\'z hisobingizni o\'chira olmaysiz.' });
    }
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'Foydalanuvchi topilmadi.' });
    await Purchase.deleteMany({ userId: req.params.id });
    await Progress.deleteMany({ userId: req.params.id });
    await UserProgress.deleteMany({ userId: req.params.id });
    await TaskSubmission.deleteMany({ userId: req.params.id });
    res.json({ success: true, message: 'Foydalanuvchi o\'chirildi.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── COURSES ──────────────────────────────────────────────────────────────────

// @desc    Get all courses (admin view — all, not just published)
// @route   GET /api/admin/courses
const getCourses = async (req, res) => {
  try {
    const courses = await Course.find().sort({ createdAt: -1 }).populate('instructor', 'name email');

    const coursesWithMeta = await Promise.all(
      courses.map(async (c) => {
        const modules = await Module.find({ courseId: c._id });
        const moduleIds = modules.map((m) => m._id);
        const totalLessons = await Lesson.countDocuments({ moduleId: { $in: moduleIds } });
        const enrolledCount = await User.countDocuments({ enrolledCourses: c._id });
        return {
          id: c._id,
          title: c.title,
          description: c.description,
          image: c.image,
          price: c.price ?? 99000,
          category: c.category,
          isPublished: c.isPublished,
          totalLessons,
          enrolled: enrolledCount,
          createdAt: c.createdAt,
        };
      })
    );

    res.json({ success: true, count: courses.length, courses: coursesWithMeta });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Create course
// @route   POST /api/admin/courses
const createCourse = async (req, res) => {
  try {
    const { title, description, category, categoryId, price, isPublished } = req.body;
    const image = buildUploadPath(req.file);
    const resolvedCategory = await resolveCourseCategory({ categoryId, category, fallbackToDefault: true });

    if (!title || !description) {
      return res.status(400).json({
        success: false,
        message: 'title va description majburiy.'
      });
    }

    const course = await Course.create({
      title,
      description,
      image,
      category: resolvedCategory?.name || category || 'Programming',
      categoryId: resolvedCategory?._id || null,
      price: normalizePrice(price),
      isPublished: normalizePublished(isPublished, true),
      instructor: req.user._id,
    });

    safeNotify(() => notifyStudents({
      title: 'Yangi kurs qo\'shildi',
      message: `"${course.title}" kursi platformaga qo'shildi.`,
      type: 'course_created',
    }));

    res.status(201).json({
      success: true,
      message: 'Kurs yaratildi.',
      course
    });

  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};



// @desc    Update course (title, description, category, image)
// @route   PUT /api/admin/courses/:id
const updateCourse = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ success: false, message: 'Kurs topilmadi.' });

    const { title, description, category, categoryId, price, isPublished } = req.body;
    const resolvedCategory = await resolveCourseCategory({
      categoryId,
      category,
      fallbackToDefault: false,
    });
    if (title)       course.title       = title;
    if (description) course.description = description;
    if (resolvedCategory) {
      course.category = resolvedCategory.name;
      course.categoryId = resolvedCategory._id;
    } else if (category) {
      course.category = category;
      course.categoryId = null;
    }
    if (typeof price !== 'undefined') course.price = normalizePrice(price, course.price ?? 99000);
    if (typeof isPublished !== 'undefined') course.isPublished = normalizePublished(isPublished, course.isPublished);

    // If a new image was uploaded via multer, replace the old one
    if (req.file) course.image = buildUploadPath(req.file);

    await course.save();

    res.json({
      success: true,
      message: 'Kurs yangilandi.',
      course: {
        id: course._id,
        title: course.title,
        description: course.description,
        image: course.image,
        price: course.price,
        category: course.category,
        isPublished: course.isPublished,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Delete course
// @route   DELETE /api/admin/courses/:id
const deleteCourse = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ success: false, message: 'Kurs topilmadi.' });

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

    res.json({ success: true, message: 'Kurs o\'chirildi.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Get users attached to a course with payment/progress metadata
// @route   GET /api/admin/courses/:courseId/users
const getCourseUsers = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { search = '', activity = 'all' } = req.query;

    if (!isValidObjectId(courseId)) {
      return res.status(400).json({ success: false, message: 'courseId noto\'g\'ri.' });
    }

    const course = await Course.findById(courseId).select('title price');
    if (!course) return res.status(404).json({ success: false, message: 'Kurs topilmadi.' });

    const purchases = await Purchase.find({ courseId });
    const purchaseMap = new Map(purchases.map((purchase) => [purchase.userId.toString(), purchase]));
    const purchaseUserIds = purchases.map((purchase) => purchase.userId);

    const userQuery = {
      role: 'student',
      $or: [
        { enrolledCourses: course._id },
        { purchasedCourses: course._id },
        { _id: { $in: purchaseUserIds } },
      ],
    };

    const term = String(search || '').trim();
    if (term) {
      const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      userQuery.$and = [{ $or: [{ name: regex }, { email: regex }, { phone: regex }] }];
    }

    const users = await User.find(userQuery).select('name email phone role createdAt enrolledCourses purchasedCourses').sort({ createdAt: -1 });
    const lessonIds = await getCourseLessonIds(course._id);
    const rows = await Promise.all(
      users.map((user) => buildCourseUserRow({
        user,
        courseId: course._id,
        purchase: purchaseMap.get(user._id.toString()),
        totalLessons: lessonIds.length,
        lessonIds,
      }))
    );

    const filteredRows = rows.filter((row) => activity === 'active' || activity === 'inactive'
      ? row.activityStatus === activity
      : true);

    res.json({
      success: true,
      course: { id: course._id, title: course.title },
      count: filteredRows.length,
      users: filteredRows,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Add a student to a course manually
// @route   POST /api/admin/courses/:courseId/users
const addCourseUser = async (req, res) => {
  try {
    const { courseId } = req.params;
    const { userId, email, paymentStatus } = req.body;

    if (!isValidObjectId(courseId)) {
      return res.status(400).json({ success: false, message: 'courseId noto\'g\'ri.' });
    }

    const course = await Course.findById(courseId).select('title price');
    if (!course) return res.status(404).json({ success: false, message: 'Kurs topilmadi.' });

    const user = userId
      ? await User.findById(userId)
      : await User.findOne({ email: String(email || '').trim().toLowerCase() });

    if (!user || user.role !== 'student') {
      return res.status(404).json({ success: false, message: 'Talaba topilmadi.' });
    }

    await syncManualCourseAccess({ user, course, paymentStatus });
    res.status(201).json({ success: true, message: `"${course.title}" kursiga ${user.name} qo'shildi.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Update a course user and payment status
// @route   PUT /api/admin/courses/:courseId/users/:userId
const updateCourseUser = async (req, res) => {
  try {
    const { courseId, userId } = req.params;
    const { name, email, phone, paymentStatus } = req.body;

    if (!isValidObjectId(courseId) || !isValidObjectId(userId)) {
      return res.status(400).json({ success: false, message: 'courseId yoki userId noto\'g\'ri.' });
    }

    const [course, user] = await Promise.all([
      Course.findById(courseId).select('title price'),
      User.findById(userId),
    ]);

    if (!course) return res.status(404).json({ success: false, message: 'Kurs topilmadi.' });
    if (!user) return res.status(404).json({ success: false, message: 'Foydalanuvchi topilmadi.' });

    if (email && email !== user.email) {
      const exists = await User.findOne({ email, _id: { $ne: user._id } });
      if (exists) return res.status(400).json({ success: false, message: 'Bu email boshqa foydalanuvchida mavjud.' });
      user.email = email;
    }

    if (name) user.name = name;
    if (typeof phone !== 'undefined') user.phone = phone;

    await syncManualCourseAccess({ user, course, paymentStatus });
    res.json({ success: true, message: 'Kurs foydalanuvchisi yangilandi.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Remove user from course
// @route   DELETE /api/admin/courses/:courseId/users/:userId
const removeCourseUser = async (req, res) => {
  try {
    const { courseId, userId } = req.params;

    if (!isValidObjectId(courseId) || !isValidObjectId(userId)) {
      return res.status(400).json({ success: false, message: 'courseId yoki userId noto\'g\'ri.' });
    }

    const course = await Course.findById(courseId).select('title');
    if (!course) return res.status(404).json({ success: false, message: 'Kurs topilmadi.' });

    const user = await User.findByIdAndUpdate(
      userId,
      { $pull: { enrolledCourses: course._id, purchasedCourses: course._id } },
      { new: true }
    );
    if (!user) return res.status(404).json({ success: false, message: 'Foydalanuvchi topilmadi.' });

    const lessonIds = await getCourseLessonIds(course._id);
    await Promise.all([
      Purchase.deleteOne({ userId, courseId: course._id }),
      UserProgress.deleteOne({ userId, courseId: course._id }),
      Progress.deleteMany({ userId, courseId: course._id }),
      TaskSubmission.deleteMany({ userId, lessonId: { $in: lessonIds } }),
    ]);

    res.json({ success: true, message: `${user.name} "${course.title}" kursidan olib tashlandi.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── DASHBOARD STATS ──────────────────────────────────────────────────────────

// @desc    Admin: list offline students
// @route   GET /api/admin/offline-students
const getOfflineStudents = async (req, res) => {
  try {
    const { search = '', status = 'all', courseId = '' } = req.query;
    const query = { role: 'offline_student' };

    if (['active', 'frozen', 'completed'].includes(status)) {
      query.offlineStatus = status;
    }

    if (courseId && isValidObjectId(courseId)) {
      query['offlineAccess.courseId'] = courseId;
    }

    const term = String(search || '').trim();
    if (term) {
      const regex = new RegExp(escapeRegex(term), 'i');
      query.$or = [
        { name: regex },
        { phone: regex },
        { email: regex },
        { offlineLogin: regex },
      ];
    }

    const users = await User.find(query)
      .select('name email phone role offlineLogin offlineStatus offlineNote offlineAccess createdAt')
      .sort({ createdAt: -1 });

    const courseIds = [...new Set(users.map((user) => user.offlineAccess?.courseId?.toString()).filter(Boolean))];
    const courses = await Course.find({ _id: { $in: courseIds } }).select('title');
    const courseMap = new Map(courses.map((course) => [course._id.toString(), course]));
    const totalLessonsMap = new Map();

    await Promise.all(courseIds.map(async (id) => {
      totalLessonsMap.set(id, (await getCourseLessonIds(id)).length);
    }));

    const rows = users.map((user) => {
      const id = user.offlineAccess?.courseId?.toString() || '';
      return serializeOfflineStudent(user, courseMap.get(id), totalLessonsMap.get(id) || 0);
    });

    res.json({ success: true, count: rows.length, students: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Admin: create offline student account
// @route   POST /api/admin/offline-students
const createOfflineStudent = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      phone,
      login,
      password,
      courseId,
      note,
    } = req.body || {};

    const normalizedFirstName = String(firstName || '').trim();
    const normalizedLastName = String(lastName || '').trim();
    const normalizedLogin = String(login || '').trim().toLowerCase();
    const normalizedPassword = String(password || '');

    if (!normalizedFirstName || !normalizedLastName || !normalizedLogin || !normalizedPassword || !courseId) {
      return res.status(400).json({
        success: false,
        message: 'Ism, familiya, login, parol va kurs majburiy.',
      });
    }

    if (normalizedPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Parol kamida 6 ta belgidan iborat bo\'lishi kerak.' });
    }

    if (!/^[a-z0-9._@-]{3,80}$/.test(normalizedLogin)) {
      return res.status(400).json({ success: false, message: 'Login faqat lotin harflari, raqam, nuqta, tire, pastki chiziq yoki @ dan iborat bo\'lsin.' });
    }

    if (!isValidObjectId(courseId)) {
      return res.status(400).json({ success: false, message: 'Kurs noto\'g\'ri tanlangan.' });
    }

    const course = await Course.findById(courseId).select('title');
    if (!course) return res.status(404).json({ success: false, message: 'Kurs topilmadi.' });

    const email = buildOfflineEmail(normalizedLogin);
    const existing = await User.findOne({
      $or: [
        { email },
        { offlineLogin: normalizedLogin },
      ],
    }).select('_id');
    if (existing) {
      return res.status(400).json({ success: false, message: 'Bu login allaqachon ishlatilgan.' });
    }

    const user = await User.create({
      name: `${normalizedFirstName} ${normalizedLastName}`.trim(),
      email,
      offlineLogin: normalizedLogin,
      phone: String(phone || '').trim(),
      password: normalizedPassword,
      role: 'offline_student',
      offlineStatus: 'active',
      offlineNote: String(note || '').trim(),
      offlineAccess: {
        courseId,
        allowedLessons: [],
      },
    });

    const totalLessons = (await getCourseLessonIds(course._id)).length;
    res.status(201).json({
      success: true,
      message: 'Offline account yaratildi.',
      student: serializeOfflineStudent(user, course, totalLessons),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Admin: get lesson access state for an offline student
// @route   GET /api/admin/offline-students/:id/access
const getOfflineStudentAccess = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Foydalanuvchi ID noto\'g\'ri.' });
    }

    const user = await User.findOne({ _id: req.params.id, role: 'offline_student' })
      .select('name phone email offlineLogin offlineStatus offlineNote offlineAccess createdAt');
    if (!user) return res.status(404).json({ success: false, message: 'Offline o\'quvchi topilmadi.' });

    const course = user.offlineAccess?.courseId
      ? await Course.findById(user.offlineAccess.courseId).select('title')
      : null;
    if (!course) return res.status(404).json({ success: false, message: 'Offline kurs topilmadi.' });

    const allowedSet = new Set((user.offlineAccess.allowedLessons || []).map((id) => id.toString()));
    const lessons = (await getCourseLessonsDetailed(course._id)).map((lesson) => ({
      ...lesson,
      allowed: allowedSet.has(lesson.id.toString()),
    }));

    res.json({
      success: true,
      student: serializeOfflineStudent(user, course, lessons.length),
      lessons,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Admin: update lesson access for an offline student
// @route   PUT /api/admin/offline-students/:id/access
const updateOfflineStudentAccess = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Foydalanuvchi ID noto\'g\'ri.' });
    }

    const user = await User.findOne({ _id: req.params.id, role: 'offline_student' });
    if (!user) return res.status(404).json({ success: false, message: 'Offline o\'quvchi topilmadi.' });

    const courseId = user.offlineAccess?.courseId;
    if (!courseId) return res.status(400).json({ success: false, message: 'Offline kurs biriktirilmagan.' });

    const requestedLessons = Array.isArray(req.body.allowedLessons) ? req.body.allowedLessons : [];
    const uniqueRequested = [...new Set(requestedLessons.map((id) => String(id || '').trim()).filter(Boolean))];
    if (uniqueRequested.some((id) => !isValidObjectId(id))) {
      return res.status(400).json({ success: false, message: 'Dars ID noto\'g\'ri.' });
    }

    const validLessons = await getCourseLessonIds(courseId);
    const validLessonSet = new Set(validLessons.map((id) => id.toString()));
    const allowedLessons = uniqueRequested.filter((id) => validLessonSet.has(id));

    user.offlineAccess.allowedLessons = allowedLessons;
    if (typeof req.body.status !== 'undefined') {
      user.offlineStatus = normalizeOfflineStatus(req.body.status, user.offlineStatus || 'active');
    }
    if (typeof req.body.note !== 'undefined') {
      user.offlineNote = String(req.body.note || '').trim();
    }

    await user.save();

    const course = await Course.findById(courseId).select('title');
    res.json({
      success: true,
      message: 'Dars ruxsatlari saqlandi.',
      student: serializeOfflineStudent(user, course, validLessons.length),
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Admin dashboard summary stats
// @route   GET /api/admin/stats
const getStats = async (req, res) => {
  try {
    const [totalUsers, totalCourses, totalStudents, totalLessons] = await Promise.all([
      User.countDocuments(),
      Course.countDocuments(),
      User.countDocuments({ role: 'student' }),
      Lesson.countDocuments(),
    ]);
    res.json({ success: true, stats: { totalUsers, totalCourses, totalStudents, totalLessons } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
// @desc    Assign course to user
// @route   POST /api/admin/assign-course
const assignCourseToUser = async (req, res) => {
  try {
    const { userId, courseId } = req.body;

    if (!userId || !courseId) {
      return res.status(400).json({ success: false, message: 'userId va courseId majburiy.' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'Foydalanuvchi topilmadi.' });

    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ success: false, message: 'Kurs topilmadi.' });

    // Avoid duplicates
    if (user.enrolledCourses.some(id => id.toString() === courseId))  {
      return res.status(400).json({ success: false, message: 'Bu kurs allaqachon biriktirilgan.' });
    }

    user.enrolledCourses.push(courseId);
    await user.save();

    res.json({
      success: true,
      message: `"${course.title}" kursi ${user.name} ga biriktirildi.`,
      enrolledCourses: user.enrolledCourses,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Upload certificate PDF for user
// @route   POST /api/admin/certificates
const uploadCertificate = async (req, res) => {
  try {
    const { userId, courseId } = req.body;

    if (!userId || !courseId) {
      return res.status(400).json({ success: false, message: 'userId va courseId majburiy.' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'PDF file majburiy.' });
    }

    const [user, course] = await Promise.all([
      User.findById(userId).select('name'),
      Course.findById(courseId).select('title'),
    ]);

    if (!user) {
      return res.status(404).json({ success: false, message: 'Foydalanuvchi topilmadi.' });
    }

    if (!course) {
      return res.status(404).json({ success: false, message: 'Kurs topilmadi.' });
    }

    const certificate = await Certificate.findOneAndUpdate(
      { userId, courseId },
      { userId, courseId, file: buildUploadPath(req.file) },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );

    res.status(201).json({
      success: true,
      message: `"${course.title}" uchun sertifikat yuklandi.`,
      certificate,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  getCourses,
  createCourse,
  updateCourse,
  deleteCourse,
  getCourseUsers,
  addCourseUser,
  updateCourseUser,
  removeCourseUser,
  getOfflineStudents,
  createOfflineStudent,
  getOfflineStudentAccess,
  updateOfflineStudentAccess,
  getStats,
  assignCourseToUser,
  uploadCertificate,
};
