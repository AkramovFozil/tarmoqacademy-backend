const allowedVideoOrigins = () => (process.env.VIDEO_ALLOWED_ORIGINS || [
  'https://tarmoqacademy.uz',
  'https://www.tarmoqacademy.uz',
  'https://api.tarmoqacademy.uz',
].join(','))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const videoHotlinkMiddleware = (req, res, next) => {
  const source = req.get('origin') || req.get('referer');
  if (!source) return next();

  let sourceOrigin;
  try {
    sourceOrigin = new URL(source).origin;
  } catch {
    return res.status(403).json({ success: false, message: 'Video source noto\'g\'ri.' });
  }

  if (!allowedVideoOrigins().includes(sourceOrigin)) {
    return res.status(403).json({ success: false, message: 'Video hotlink bloklandi.' });
  }

  return next();
};

module.exports = videoHotlinkMiddleware;
