const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const { uploadTask } = require('../middleware/uploadMiddleware');
const {
  submitTaskAnswer,
  listTaskSubmissions,
  reviewTaskSubmission,
} = require('../controllers/taskController');

router.post('/submit', authMiddleware, uploadTask.single('file'), submitTaskAnswer);
router.get('/admin/submissions', authMiddleware, roleMiddleware('admin'), listTaskSubmissions);
router.put('/admin/submissions/:id/review', authMiddleware, roleMiddleware('admin'), reviewTaskSubmission);

module.exports = router;
