const Purchase = require('../models/Purchase');
const User = require('../models/User');
const Course = require('../models/Course');
const { createNotification, notifyAdmins, safeNotify } = require('../services/notificationService');

const DEFAULT_PURCHASE_AMOUNT = 99000;

const hasCourseAccess = (user, courseId) => {
  if (!user) return false;
  if (user.role === 'admin') return true;

  return [...(user.enrolledCourses || []), ...(user.purchasedCourses || [])].some(
    (id) => id.toString() === courseId.toString()
  );
};

const normalizeAmount = (rawAmount, fallbackAmount = DEFAULT_PURCHASE_AMOUNT) => {
  const amount = Number(rawAmount);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount) : fallbackAmount;
};

const grantCourseAccess = async (user, courseId) => {
  let changed = false;

  if (!user.purchasedCourses.some((id) => id.toString() === courseId.toString())) {
    user.purchasedCourses.push(courseId);
    changed = true;
  }

  if (!user.enrolledCourses.some((id) => id.toString() === courseId.toString())) {
    user.enrolledCourses.push(courseId);
    changed = true;
  }

  if (changed) {
    await user.save();
  }
};

const simulatePaymentSuccess = async () => {
  await Promise.resolve();
  return { status: 'paid' };
};

const createPurchase = async (req, res) => {
  try {
    const courseId = req.body.courseId || req.params.courseId;

    if (!courseId) {
      return res.status(400).json({
        success: false,
        message: 'courseId majburiy.',
      });
    }

    const [user, course] = await Promise.all([
      User.findById(req.user._id).select('role name enrolledCourses purchasedCourses'),
      Course.findById(courseId).select('title isPublished price'),
    ]);

    const amount = normalizeAmount(
      req.body.amount,
      Number(course?.price) > 0 ? Number(course.price) : DEFAULT_PURCHASE_AMOUNT
    );

    if (!user) {
      return res.status(404).json({ success: false, message: 'Foydalanuvchi topilmadi.' });
    }

    if (user.role === 'admin') {
      return res.status(400).json({
        success: false,
        message: 'Administrator hisoblari uchun xarid talab qilinmaydi.',
      });
    }

    if (user.role === 'offline_student') {
      return res.status(403).json({
        success: false,
        message: 'Offline o\'quvchilar uchun payment funksiyasi yopiq.',
      });
    }

    if (!course || !course.isPublished) {
      return res.status(404).json({ success: false, message: 'Kurs topilmadi.' });
    }

    let purchase = await Purchase.findOne({ userId: user._id, courseId: course._id });

    if (purchase?.status === 'paid' || hasCourseAccess(user, course._id)) {
      if (purchase && !purchase.paidAt) {
        purchase.paidAt = purchase.updatedAt || purchase.createdAt || new Date();
        await purchase.save();
      }

      await grantCourseAccess(user, course._id);

      return res.status(200).json({
        success: true,
        message: `"${course.title}" kursi allaqachon ochilgan.`,
        purchase: purchase
          ? {
              id: purchase._id,
              userId: purchase.userId,
              courseId: purchase.courseId,
              amount: purchase.amount,
              status: purchase.status,
              paidAt: purchase.paidAt || purchase.updatedAt || purchase.createdAt || null,
            }
          : null,
        purchased: true,
      });
    }

    if (!purchase) {
      purchase = await Purchase.create({
        userId: user._id,
        courseId: course._id,
        amount,
        status: 'pending',
      });
    } else {
      purchase.amount = amount;
      purchase.status = 'pending';
      await purchase.save();
    }

    const paymentResult = await simulatePaymentSuccess(purchase);
    purchase.status = paymentResult.status;
    purchase.paidAt = paymentResult.status === 'paid' ? new Date() : null;
    await purchase.save();

    if (purchase.status === 'paid') {
      await grantCourseAccess(user, course._id);
      safeNotify(() => createNotification({
        userId: user._id,
        title: 'Payment tasdiqlandi',
        message: `"${course.title}" kursi uchun to'lov tasdiqlandi.`,
        type: 'payment_approved',
      }));
      safeNotify(() => notifyAdmins({
        title: 'Yangi payment request',
        message: `${user.name} "${course.title}" kursi uchun to'lov qildi.`,
        type: 'admin_payment_request',
      }));
    }

    return res.status(201).json({
      success: true,
      message: `"${course.title}" kursi muvaffaqiyatli sotib olindi.`,
      purchase: {
        id: purchase._id,
        userId: purchase.userId,
        courseId: purchase.courseId,
        amount: purchase.amount,
        status: purchase.status,
        paidAt: purchase.paidAt,
      },
      purchased: purchase.status === 'paid',
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Bu kurs uchun xarid yozuvi allaqachon mavjud.',
      });
    }

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const createPurchaseFromLegacyRoute = (req, res) => {
  req.body = {
    ...req.body,
    courseId: req.params.courseId,
  };

  return createPurchase(req, res);
};

const getMyPurchases = async (req, res) => {
  try {
    if (req.user?.role === 'offline_student') {
      return res.status(200).json({
        success: true,
        purchases: [],
      });
    }

    const purchases = await Purchase.find({
      userId: req.user._id,
      status: 'paid',
    })
      .populate('courseId', 'title image price category')
      .sort({ paidAt: -1, createdAt: -1 });

    return res.status(200).json({
      success: true,
      purchases: purchases
        .filter((purchase) => purchase.courseId)
        .map((purchase) => ({
          id: purchase._id,
          amount: purchase.amount,
          status: purchase.status,
          paidAt: purchase.paidAt || purchase.updatedAt || purchase.createdAt,
          createdAt: purchase.createdAt,
          course: {
            id: purchase.courseId._id,
            title: purchase.courseId.title,
            image: purchase.courseId.image,
            price: purchase.courseId.price ?? purchase.amount,
            category: purchase.courseId.category,
          },
        })),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  createPurchase,
  createPurchaseFromLegacyRoute,
  getMyPurchases,
};
