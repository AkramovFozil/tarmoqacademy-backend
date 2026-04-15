const https = require('https');
const Course = require('../models/Course');
const Lesson = require('../models/Lesson');
const Module = require('../models/Module');
const TaskSubmission = require('../models/TaskSubmission');
const User = require('../models/User');

const OPENAI_API_HOST = 'api.openai.com';
const OPENAI_API_PATH = '/v1/responses';

const hasFullCourseAccess = (user, courseId) => {
  if (!user) return false;
  if (user.role === 'admin') return true;

  return [...(user.enrolledCourses || []), ...(user.purchasedCourses || [])].some(
    (id) => id.toString() === courseId.toString()
  );
};

const getPreviewLessonId = async (courseId) => {
  const firstModule = await Module.findOne({ courseId }).sort({ order: 1 }).select('_id');
  if (!firstModule) return null;

  const firstLesson = await Lesson.findOne({ moduleId: firstModule._id }).sort({ order: 1 }).select('_id');
  return firstLesson?._id?.toString() || null;
};

const requestOpenAI = (payload, apiKey) =>
  new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);

    const req = https.request(
      {
        hostname: OPENAI_API_HOST,
        path: OPENAI_API_PATH,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');

        res.on('data', (chunk) => {
          raw += chunk;
        });

        res.on('end', () => {
          try {
            const parsed = JSON.parse(raw || '{}');

            if (res.statusCode < 200 || res.statusCode >= 300) {
              return reject(
                new Error(parsed?.error?.message || 'OpenAI API so\'rovi bajarilmadi.')
              );
            }

            return resolve(parsed);
          } catch (error) {
            return reject(new Error('OpenAI javobini o\'qib bo\'lmadi.'));
          }
        });
      }
    );

    req.on('error', (error) => {
      reject(error);
    });

    req.write(data);
    req.end();
  });

const extractOutputText = (response) => {
  if (!response || !Array.isArray(response.output)) {
    return '';
  }

  return response.output
    .flatMap((item) => item?.content || [])
    .filter((item) => item?.type === 'output_text' && item.text)
    .map((item) => item.text)
    .join('\n')
    .trim();
};

// @desc    Ask AI about a lesson
// @route   POST /api/ai/lesson-chat
// @access  Private
const askLessonAssistant = async (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        success: false,
        message: 'OPENAI_API_KEY sozlanmagan.',
      });
    }

    const { lessonId, question } = req.body;
    const normalizedQuestion = String(question || '').trim();

    if (!lessonId || !normalizedQuestion) {
      return res.status(400).json({
        success: false,
        message: 'lessonId va question majburiy.',
      });
    }

    const lesson = await Lesson.findById(lessonId).populate('moduleId');
    if (!lesson) {
      return res.status(404).json({ success: false, message: 'Dars topilmadi.' });
    }

    const [course, user, submission] = await Promise.all([
      Course.findById(lesson.moduleId.courseId).select('title description isPublished'),
      User.findById(req.user._id).select('role enrolledCourses purchasedCourses'),
      TaskSubmission.findOne({ userId: req.user._id, lessonId }).select('answer updatedAt'),
    ]);

    if (!course) {
      return res.status(404).json({ success: false, message: 'Kurs topilmadi.' });
    }

    const fullAccess = hasFullCourseAccess(user, course._id);
    let previewAccess = false;

    if (!fullAccess && course.isPublished) {
      const previewLessonId = await getPreviewLessonId(course._id);
      previewAccess = previewLessonId === lesson._id.toString();
    }

    if (!fullAccess && !previewAccess) {
      return res.status(403).json({ success: false, message: 'Kursni sotib olish kerak.' });
    }

    const prompt = [
      `Kurs: ${course.title}`,
      `Kurs tavsifi: ${course.description || 'Tavsif yo\'q.'}`,
      `Modul: ${lesson.moduleId.title}`,
      `Dars: ${lesson.title}`,
      `Dars matni: ${lesson.content || 'Matn yo\'q.'}`,
      `Topshiriq: ${lesson.task || 'Topshiriq yo\'q.'}`,
      `Talaba javobi: ${submission?.answer || 'Javob yuborilmagan.'}`,
      `Savol: ${normalizedQuestion}`,
    ].join('\n\n');

    const response = await requestOpenAI(
      {
        model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        instructions:
          'Siz Tarmoq Academy ichidagi qisqa AI yordamchisiz. Faqat berilgan dars kontekstiga tayangan holda, o\'zbek tilida, aniq va ixcham javob bering. Agar javob uchun ma\'lumot yetarli bo\'lmasa, buni ochiq ayting va taxmin qilmang.',
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: prompt,
              },
            ],
          },
        ],
        max_output_tokens: 400,
        store: false,
        safety_identifier: `user-${req.user._id}`,
      },
      apiKey
    );

    const answer = extractOutputText(response);
    if (!answer) {
      return res.status(502).json({
        success: false,
        message: 'AI javobi bo\'sh qaytdi.',
      });
    }

    return res.status(200).json({
      success: true,
      answer,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  askLessonAssistant,
};
