const express = require('express');
const router = express.Router();
const {
  getCourses,
  getCourseById,
  createCourse,
  updateCourse,
  deleteCourse,
} = require('../controllers/courseController');
const { getMyCourses } = require('../controllers/userController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

// Public with auth
router.get('/', authMiddleware, getCourses);
router.get('/my', authMiddleware, getMyCourses);
router.get('/:id', authMiddleware, getCourseById);

// Admin only
router.post('/', authMiddleware, roleMiddleware('admin'), createCourse);
router.put('/:id', authMiddleware, roleMiddleware('admin'), updateCourse);
router.delete('/:id', authMiddleware, roleMiddleware('admin'), deleteCourse);

module.exports = router;
