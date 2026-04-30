const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const {
  getMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} = require('../controllers/notificationController');

router.get('/', authMiddleware, getMyNotifications);
router.put('/read-all', authMiddleware, markAllNotificationsRead);
router.put('/:id/read', authMiddleware, markNotificationRead);

module.exports = router;
