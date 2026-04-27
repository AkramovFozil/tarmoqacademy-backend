const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const connectDB = require('../config/db');
const Lesson = require('../models/Lesson');
const Module = require('../models/Module');
const { transcodeToHls } = require('../services/videoTranscoder');
const { normalizeKey, uploadDirectory, getPublicUrl } = require('../services/r2Service');

const uploadsRoot = process.env.UPLOADS_DIR
  ? (path.isAbsolute(process.env.UPLOADS_DIR)
      ? process.env.UPLOADS_DIR
      : path.resolve(__dirname, '..', process.env.UPLOADS_DIR))
  : path.join(__dirname, '..', 'uploads');

const resolveLocalVideoPath = (videoUrl) => {
  const raw = String(videoUrl || '').trim();
  if (!raw || /^https?:\/\//i.test(raw)) return '';

  const normalized = raw.replace(/\\/g, '/').replace(/^\/+/, '');
  const relative = normalized.startsWith('uploads/')
    ? normalized.slice('uploads/'.length)
    : normalized;

  const fullPath = path.resolve(uploadsRoot, relative);
  if (!fullPath.startsWith(path.resolve(uploadsRoot))) return '';
  return fullPath;
};

const migrateLesson = async (lesson) => {
  const module = await Module.findById(lesson.moduleId).select('courseId');
  if (!module) {
    console.log(`[skip] ${lesson._id}: module topilmadi`);
    return;
  }

  const inputPath = resolveLocalVideoPath(lesson.videoUrl);
  if (!inputPath || !fs.existsSync(inputPath)) {
    console.log(`[skip] ${lesson._id}: lokal MP4 topilmadi (${lesson.videoUrl})`);
    return;
  }

  const workDir = path.join(uploadsRoot, '.migration-hls', lesson._id.toString());
  const hlsDir = path.join(workDir, 'hls');

  console.log(`[convert] ${lesson._id}: ${inputPath}`);
  const result = await transcodeToHls({ inputPath, outputRoot: hlsDir });
  const keyPrefix = normalizeKey(`courses/${module.courseId}/lessons/${lesson._id}`);

  console.log(`[upload] ${lesson._id}: ${keyPrefix}`);
  await uploadDirectory({ directory: result.outputRoot, keyPrefix });

  lesson.videoType = 'hls';
  lesson.hlsKey = keyPrefix;
  lesson.hlsRenditions = result.renditions;
  lesson.videoUrl = getPublicUrl(`${keyPrefix}/master.m3u8`);
  await lesson.save();

  await fs.promises.rm(workDir, { recursive: true, force: true });
  console.log(`[done] ${lesson._id}: ${lesson.videoUrl}`);
};

const main = async () => {
  await connectDB();

  const onlyLessonId = process.argv.find((arg) => arg.startsWith('--lessonId='))?.split('=')[1];
  const query = {
    videoType: { $ne: 'hls' },
    videoUrl: /\.mp4($|\?)/i,
  };

  if (onlyLessonId) {
    query._id = onlyLessonId;
  }

  const lessons = await Lesson.find(query).sort({ createdAt: 1 });
  console.log(`Migratsiya uchun ${lessons.length} ta dars topildi.`);

  for (const lesson of lessons) {
    try {
      await migrateLesson(lesson);
    } catch (error) {
      console.error(`[error] ${lesson._id}: ${error.message}`);
      if (process.env.MIGRATION_CONTINUE_ON_ERROR !== 'true') {
        throw error;
      }
    }
  }

  await process.exit(0);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
