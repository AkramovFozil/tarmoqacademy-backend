const express = require('express');
const router = express.Router();
const {
  completeLesson,
  getUserStats,
  getCourseProgress,
  getUserProgressByCourse,
  markLessonViewed,
  updateLessonProgress,
} = require('../controllers/progressController');
const authMiddleware = require('../middleware/authMiddleware');

router.post('/complete', authMiddleware, completeLesson);
router.post('/view', authMiddleware, markLessonViewed);
router.post('/update', authMiddleware, updateLessonProgress);
router.get('/stats', authMiddleware, getUserStats);
router.get('/course/:courseId', authMiddleware, getCourseProgress);
router.get('/:courseId', authMiddleware, getUserProgressByCourse);

module.exports = router;
