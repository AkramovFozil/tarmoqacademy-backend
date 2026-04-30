const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');
const Lesson = require('../models/Lesson');
const Module = require('../models/Module');
const { isOfflineLessonAllowed, isUserEnrolledInCourse, getPreviewLessonKey } = require('../utils/lessonVideo');
const { transcodeToHls } = require('../services/videoTranscoder');
const {
  normalizeKey,
  uploadDirectory,
  getObjectText,
  createPresignedGetUrl,
  getPublicUrl,
} = require('../services/r2Service');

const tokenSecret = () => process.env.VIDEO_TOKEN_SECRET || process.env.JWT_SECRET;
const tokenTtl = () => process.env.VIDEO_TOKEN_TTL || '2h';
const segmentUrlTtl = () => Number(process.env.R2_SEGMENT_URL_TTL_SECONDS || 3600);

const getApiBaseUrl = (req) => {
  const configured = String(process.env.API_PUBLIC_URL || '').replace(/\/+$/, '');
  if (configured) return configured;
  return `${req.protocol}://${req.get('host')}`;
};

const getLessonWithModule = async (lessonId) => Lesson.findById(lessonId).populate('moduleId');

const canAccessLesson = async (user, lesson) => {
  if (!lesson?.moduleId?.courseId) return false;
  const hasFullAccess = isUserEnrolledInCourse(user, lesson.moduleId.courseId);
  if (hasFullAccess) return true;
  if (isOfflineLessonAllowed(user, lesson.moduleId.courseId, lesson._id)) return true;

  const previewLessonKey = await getPreviewLessonKey(lesson.moduleId.courseId);
  return previewLessonKey === lesson._id.toString();
};

const createVideoToken = (lesson, user) => jwt.sign(
  {
    lessonId: lesson._id.toString(),
    userId: user._id.toString(),
    courseId: lesson.moduleId.courseId.toString(),
    type: 'lesson-video',
  },
  tokenSecret(),
  { expiresIn: tokenTtl() }
);

const verifyVideoToken = async (req, res) => {
  const token = String(req.query.token || '');
  if (!token) {
    res.status(401).json({ success: false, message: 'Video token topilmadi.' });
    return null;
  }

  let payload;
  try {
    payload = jwt.verify(token, tokenSecret());
  } catch {
    res.status(401).json({ success: false, message: 'Video token eskirgan yoki noto\'g\'ri.' });
    return null;
  }

  if (payload.type !== 'lesson-video' || String(payload.lessonId) !== String(req.params.lessonId)) {
    res.status(403).json({ success: false, message: 'Video token bu dars uchun emas.' });
    return null;
  }

  const lesson = await getLessonWithModule(req.params.lessonId);
  if (!lesson || lesson.videoType !== 'hls' || !lesson.hlsKey) {
    res.status(404).json({ success: false, message: 'HLS video topilmadi.' });
    return null;
  }

  return { payload, lesson, token };
};

const rewriteMasterPlaylist = ({ playlist, req, token }) => {
  const apiBaseUrl = getApiBaseUrl(req);
  return playlist
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;

      const quality = trimmed.split('/')[0];
      return `${apiBaseUrl}/api/videos/${req.params.lessonId}/playlists/${encodeURIComponent(quality)}/index.m3u8?token=${encodeURIComponent(token)}`;
    })
    .join('\n');
};

const rewriteMediaPlaylist = async ({ playlist, lesson, quality }) => {
  const baseKey = normalizeKey(`${lesson.hlsKey}/${quality}`);
  const lines = await Promise.all(
    playlist.split('\n').map(async (line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;

      const segmentKey = normalizeKey(`${baseKey}/${trimmed}`);
      return createPresignedGetUrl({
        key: segmentKey,
        expiresIn: segmentUrlTtl(),
      });
    })
  );

  return lines.join('\n');
};

const getPlaybackUrl = async (req, res) => {
  try {
    const lesson = await getLessonWithModule(req.params.lessonId);
    if (!lesson) {
      return res.status(404).json({ success: false, message: 'Dars topilmadi.' });
    }

    if (!await canAccessLesson(req.user, lesson)) {
      return res.status(403).json({ success: false, message: 'Bu video uchun ruxsat yo\'q.' });
    }

    if (lesson.videoType !== 'hls' || !lesson.hlsKey) {
      return res.status(400).json({ success: false, message: 'Bu dars HLS formatga o\'tkazilmagan.' });
    }

    const token = createVideoToken(lesson, req.user);
    res.json({
      success: true,
      videoType: 'hls',
      streamUrl: `${getApiBaseUrl(req)}/api/videos/${lesson._id}/master.m3u8?token=${encodeURIComponent(token)}`,
      expiresIn: tokenTtl(),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getMasterPlaylist = async (req, res) => {
  try {
    const verified = await verifyVideoToken(req, res);
    if (!verified) return;

    const playlist = await getObjectText(`${verified.lesson.hlsKey}/master.m3u8`);
    res.set({
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'private, max-age=30',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(rewriteMasterPlaylist({ playlist, req, token: verified.token }));
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const getVariantPlaylist = async (req, res) => {
  try {
    const verified = await verifyVideoToken(req, res);
    if (!verified) return;

    const quality = String(req.params.quality || '').replace(/[^\d]/g, '');
    if (!verified.lesson.hlsRenditions.includes(Number(quality))) {
      return res.status(404).json({ success: false, message: 'Bunday video sifati topilmadi.' });
    }

    const playlist = await getObjectText(`${verified.lesson.hlsKey}/${quality}/index.m3u8`);
    const rewritten = await rewriteMediaPlaylist({
      playlist,
      lesson: verified.lesson,
      quality,
    });

    res.set({
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'private, max-age=30',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(rewritten);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const uploadLessonVideo = async (req, res) => {
  let workDir = '';

  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'MP4 video fayl yuboring.' });
    }

    if (!/\.mp4$/i.test(req.file.originalname) && req.file.mimetype !== 'video/mp4') {
      await fs.promises.rm(req.file.path, { force: true });
      return res.status(400).json({ success: false, message: 'Faqat MP4 video qabul qilinadi.' });
    }

    const lesson = await getLessonWithModule(req.params.lessonId);
    if (!lesson) {
      return res.status(404).json({ success: false, message: 'Dars topilmadi.' });
    }

    workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tarmoq-hls-'));
    const hlsDir = path.join(workDir, 'hls');
    const result = await transcodeToHls({ inputPath: req.file.path, outputRoot: hlsDir });
    const keyPrefix = normalizeKey(`courses/${lesson.moduleId.courseId}/lessons/${lesson._id}`);

    await uploadDirectory({ directory: result.outputRoot, keyPrefix });
    await fs.promises.rm(req.file.path, { force: true });

    lesson.videoType = 'hls';
    lesson.hlsKey = keyPrefix;
    lesson.hlsRenditions = result.renditions;
    lesson.videoUrl = getPublicUrl(`${keyPrefix}/master.m3u8`);
    await lesson.save();

    const token = createVideoToken(lesson, req.user);
    res.json({
      success: true,
      message: 'Video HLS formatga o\'tkazildi va R2 ga yuklandi.',
      lesson,
      streamUrl: `${getApiBaseUrl(req)}/api/videos/${lesson._id}/master.m3u8?token=${encodeURIComponent(token)}`,
    });
  } catch (error) {
    if (req.file?.path) {
      await fs.promises.rm(req.file.path, { force: true }).catch(() => {});
    }
    res.status(500).json({ success: false, message: error.message });
  } finally {
    if (workDir) {
      await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
};

module.exports = {
  getPlaybackUrl,
  getMasterPlaylist,
  getVariantPlaylist,
  uploadLessonVideo,
};
