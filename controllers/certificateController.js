const User = require('../models/User');
const Course = require('../models/Course');
const Module = require('../models/Module');
const Lesson = require('../models/Lesson');
const UserProgress = require('../models/UserProgress');
const Certificate = require('../models/Certificate');

const formatDate = (date) =>
  new Date(date).toLocaleDateString('uz-UZ', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

const buildCertificateHtml = ({ userName, courseTitle, issuedDate }) => `<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Certificate - ${courseTitle}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, 'Times New Roman', serif;
      background: #eef3ff;
      color: #1f2937;
      padding: 32px;
    }
    .certificate {
      max-width: 980px;
      margin: 0 auto;
      background: linear-gradient(135deg, #ffffff, #f8fbff);
      border: 14px solid #1d4ed8;
      border-radius: 28px;
      padding: 56px;
      box-shadow: 0 20px 60px rgba(29, 78, 216, 0.14);
      text-align: center;
    }
    .eyebrow {
      font-size: 18px;
      letter-spacing: 5px;
      text-transform: uppercase;
      color: #1d4ed8;
      margin-bottom: 18px;
      font-weight: 700;
    }
    .title {
      font-size: 56px;
      margin: 0 0 14px;
      color: #0f172a;
    }
    .subtitle {
      font-size: 22px;
      color: #475569;
      margin-bottom: 36px;
    }
    .name {
      font-size: 44px;
      color: #111827;
      margin: 18px 0;
      font-weight: 700;
    }
    .course {
      font-size: 32px;
      color: #1d4ed8;
      margin: 20px 0 36px;
      font-weight: 700;
    }
    .date {
      font-size: 18px;
      color: #475569;
      margin-top: 40px;
    }
    .seal {
      width: 120px;
      height: 120px;
      margin: 34px auto 0;
      border-radius: 50%;
      border: 6px solid rgba(29, 78, 216, 0.18);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #1d4ed8;
      font-size: 18px;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <div class="certificate">
    <div class="eyebrow">Tarmoq Academy</div>
    <h1 class="title">Certificate</h1>
    <div class="subtitle">Ushbu sertifikat quyidagi foydalanuvchiga beriladi</div>
    <div class="name">${userName}</div>
    <div class="subtitle">quyidagi kursni muvaffaqiyatli yakunlagani uchun</div>
    <div class="course">${courseTitle}</div>
    <div class="date">Sana: ${issuedDate}</div>
    <div class="seal">100% Complete</div>
  </div>
</body>
</html>`;

// @desc    Download certificate for completed course
// @route   GET /api/certificate/:courseId
// @access  Private
const getCertificate = async (req, res) => {
  try {
    if (req.user?.role === 'offline_student') {
      return res.status(403).json({
        success: false,
        message: 'Offline o\'quvchilar uchun sertifikat funksiyasi yopiq.',
      });
    }

    const { courseId } = req.params;

    const [user, course, modules, userProgress, uploadedCertificate] = await Promise.all([
      User.findById(req.user._id).select('name'),
      Course.findById(courseId).select('title'),
      Module.find({ courseId }).select('_id'),
      UserProgress.findOne({ userId: req.user._id, courseId }).select('completedLessons'),
      Certificate.findOne({ userId: req.user._id, courseId }).select('file'),
    ]);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found.' });
    }

    if (uploadedCertificate?.file) {
      return res.status(200).json({
        success: true,
        courseId,
        file: uploadedCertificate.file,
        downloadUrl: `/uploads/${uploadedCertificate.file}`,
      });
    }

    const moduleIds = modules.map((module) => module._id);
    const lessons = await Lesson.find({ moduleId: { $in: moduleIds } }).select('_id');
    const lessonIds = lessons.map((lesson) => lesson._id.toString());
    const completedLessons = (userProgress?.completedLessons || [])
      .map((id) => id.toString())
      .filter((id) => lessonIds.includes(id));

    const progress =
      lessonIds.length > 0
        ? Math.round((completedLessons.length / lessonIds.length) * 100)
        : 0;

    if (progress < 100) {
      return res.status(400).json({
        success: false,
        message: 'Certificate olish uchun course progress 100% bo‘lishi kerak.',
      });
    }

    const html = buildCertificateHtml({
      userName: user.name,
      courseTitle: course.title,
      issuedDate: formatDate(new Date()),
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="certificate-${course.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.html"`
    );
    res.status(200).send(html);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getCertificate };
