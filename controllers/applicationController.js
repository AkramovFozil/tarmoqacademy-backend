const Application = require('../models/Application');
const { notifyAdmins, safeNotify } = require('../services/notificationService');
const { sendTelegramMessage } = require('../services/telegramService');

const ALLOWED_STATUSES = new Set(['new', 'contacted', 'approved']);

const createApplication = async (req, res) => {
  try {
    const { name, surname, phone, course } = req.body || {};
    const normalizedName = String(name || '').trim();
    const normalizedSurname = String(surname || '').trim();
    const normalizedPhone = String(phone || '').trim();
    const normalizedCourse = String(course || '').trim();

    if (!normalizedName || !normalizedSurname || !normalizedPhone) {
      return res.status(400).json({
        success: false,
        message: 'name, surname va phone majburiy.',
      });
    }

    const application = await Application.create({
      name: normalizedName,
      surname: normalizedSurname,
      phone: normalizedPhone,
      course: normalizedCourse,
    });

    safeNotify(() => notifyAdmins({
      title: 'User support message yubordi',
      message: `${normalizedName} ${normalizedSurname} ${normalizedCourse ? `"${normalizedCourse}" bo'yicha` : ''} murojaat qoldirdi.`,
      type: 'admin_support_message',
    }));
    sendTelegramMessage(
      [
        normalizedCourse ? '🔥 Yangi lead' : '🆘 Yangi support xabar',
        `Ism: ${normalizedName} ${normalizedSurname}`.trim(),
        `Tel: ${normalizedPhone}`,
        ...(normalizedCourse ? [`Kurs: ${normalizedCourse}`] : []),
      ].join('\n')
    );

    return res.status(201).json({
      success: true,
      message: 'Ariza saqlandi.',
      application,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getApplications = async (req, res) => {
  try {
    const applications = await Application.find().sort({ createdAt: -1 });

    return res.json({
      success: true,
      applications,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const updateApplicationStatus = async (req, res) => {
  try {
    const status = String(req.body?.status || '').trim().toLowerCase();

    if (!ALLOWED_STATUSES.has(status)) {
      return res.status(400).json({
        success: false,
        message: 'status noto\'g\'ri.',
      });
    }

    const application = await Application.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    );

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Ariza topilmadi.',
      });
    }

    return res.json({
      success: true,
      message: 'Ariza holati yangilandi.',
      application,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  createApplication,
  getApplications,
  updateApplicationStatus,
};
