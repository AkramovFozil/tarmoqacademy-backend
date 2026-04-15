const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { askLessonAssistant } = require('../controllers/aiController');

router.post('/lesson-chat', authMiddleware, askLessonAssistant);

module.exports = router;
