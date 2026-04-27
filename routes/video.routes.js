const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const videoHotlinkMiddleware = require('../middleware/videoHotlinkMiddleware');
const { uploadVideo } = require('../middleware/uploadMiddleware');
const {
  getPlaybackUrl,
  getMasterPlaylist,
  getVariantPlaylist,
  uploadLessonVideo,
} = require('../controllers/video.controller');

const router = express.Router();

router.get('/lessons/:lessonId/playback-url', authMiddleware, getPlaybackUrl);
router.post(
  '/lessons/:lessonId/upload',
  authMiddleware,
  roleMiddleware('admin'),
  uploadVideo.single('video'),
  uploadLessonVideo
);

router.get('/:lessonId/master.m3u8', videoHotlinkMiddleware, getMasterPlaylist);
router.get('/:lessonId/playlists/:quality/index.m3u8', videoHotlinkMiddleware, getVariantPlaylist);

module.exports = router;
