const express = require('express');
const router = express.Router();
const {
  getLessonById,
  createLesson,
  updateLesson,
  deleteLesson,
} = require('../controllers/lessonController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

router.get('/:id', authMiddleware, getLessonById);

// Admin only
router.post('/', authMiddleware, roleMiddleware('admin'), createLesson);
router.put('/:id', authMiddleware, roleMiddleware('admin'), updateLesson);
router.delete('/:id', authMiddleware, roleMiddleware('admin'), deleteLesson);

module.exports = router;
