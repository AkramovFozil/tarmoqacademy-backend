const Application = require('../models/Application');
const { notifyAdmins, safeNotify } = require('../services/notificationService');
const { formatTelegramDateTime, sendTelegramMessage } = require('../services/telegramService');

const ALLOWED_STATUSES = new Set(['new', 'contacted', 'approved']);

const notifyApplicationTelegram = async ({ name, surname, phone, course }) => {
  try {
    const result = await sendTelegramMessage(
      [
        '📥 Yangi kurs arizasi',
        `👤 Ism: ${`${name} ${surname}`.trim() || '-'}`,
        `📞 Telefon: ${phone || '-'}`,
        `📚 Kurs: ${course || '-'}`,
        `🕒 Vaqt: ${formatTelegramDateTime()}`,
      ].join('\n')
    );

    if (result) {
      console.log('[telegram] application notification sent');
    } else {
      console.error('[telegram] application notification failed or skipped');
    }
  } catch (error) {
    console.error('[telegram] application notification error:', error.message);
  }
};

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
    await notifyApplicationTelegram({
      name: normalizedName,
      surname: normalizedSurname,
      phone: normalizedPhone,
      course: normalizedCourse,
    });

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

    if (status === 'approved') {
      sendTelegramMessage(
        [
          '✅ Ariza tasdiqlandi',
          `👤 Ism: ${application.name} ${application.surname}`.trim(),
          `📞 Telefon: ${application.phone || '-'}`,
          `🎓 Kurs: ${application.course || '-'}`,
          `🕒 Vaqt: ${formatTelegramDateTime()}`,
        ].join('\n')
      );
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
