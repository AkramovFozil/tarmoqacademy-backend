const express = require('express');
const router = express.Router();
const {
  getLessonById,
  streamLessonVideo,
  createLesson,
  updateLesson,
  deleteLesson,
} = require('../controllers/lessonController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const { uploadVideo } = require('../middleware/uploadMiddleware');

router.get('/:id/video', streamLessonVideo);
router.get('/:id', authMiddleware, getLessonById);

// Admin only
router.post('/', authMiddleware, roleMiddleware('admin'), uploadVideo.single('video'), createLesson);
router.put('/:id', authMiddleware, roleMiddleware('admin'), uploadVideo.single('video'), updateLesson);
router.delete('/:id', authMiddleware, roleMiddleware('admin'), deleteLesson);

module.exports = router;
