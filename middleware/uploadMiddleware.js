const fs = require('fs');
const path = require('path');
const multer = require('multer');

const uploadsRoot = process.env.UPLOADS_DIR
  ? (path.isAbsolute(process.env.UPLOADS_DIR)
      ? process.env.UPLOADS_DIR
      : path.resolve(__dirname, '..', process.env.UPLOADS_DIR))
  : path.join(__dirname, '..', 'uploads');
const imageDir = path.join(uploadsRoot, 'images');
const videoDir = path.join(uploadsRoot, 'videos');
const certificateDir = path.join(uploadsRoot, 'certificates');
const taskDir = path.join(uploadsRoot, 'tasks');
const configuredUploadMaxMb = Number(process.env.UPLOAD_MAX_MB || 1024);
const uploadMaxMb = Number.isFinite(configuredUploadMaxMb) && configuredUploadMaxMb > 0
  ? configuredUploadMaxMb
  : 1024;

[uploadsRoot, imageDir, videoDir, certificateDir, taskDir].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      return cb(null, imageDir);
    }

    if (file.mimetype.startsWith('video/')) {
      return cb(null, videoDir);
    }

    if (file.mimetype === 'application/pdf') {
      return cb(null, certificateDir);
    }

    return cb(new Error('Faqat image, video yoki pdf fayl yuklash mumkin.'));
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/\s+/g, '-');
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const createUploader = (allowedPrefix) => multer({
  storage,
  fileFilter: (req, file, cb) => {
    const isAllowed =
      allowedPrefix === 'any'
        ? file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/') || file.mimetype === 'application/pdf'
        : allowedPrefix === 'pdf'
          ? file.mimetype === 'application/pdf'
          : file.mimetype.startsWith(`${allowedPrefix}/`);

    if (isAllowed) {
      return cb(null, true);
    }

    cb(new Error(`Faqat ${allowedPrefix === 'any' ? 'image yoki video' : allowedPrefix} fayl yuklash mumkin.`));
  },
  limits: {
    fileSize: uploadMaxMb * 1024 * 1024,
  },
});

const taskStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, taskDir),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/\s+/g, '-');
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const uploadTask = multer({
  storage: taskStorage,
  fileFilter: (req, file, cb) => {
    const isAllowed =
      file.mimetype.startsWith('image/')
      || file.mimetype.startsWith('video/')
      || file.mimetype === 'application/pdf';

    if (isAllowed) {
      return cb(null, true);
    }

    return cb(new Error('Faqat PDF, rasm yoki video fayl yuklash mumkin.'));
  },
  limits: {
    fileSize: uploadMaxMb * 1024 * 1024,
  },
});

module.exports = {
  upload: createUploader('any'),
  uploadImage: createUploader('image'),
  uploadVideo: createUploader('video'),
  uploadPdf: createUploader('pdf'),
  uploadTask,
};
