const express = require('express');
const router = express.Router();
const {
  getModules,
  createModule,
  updateModule,
  deleteModule,
} = require('../controllers/moduleController');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');

router.get('/', authMiddleware, getModules);
router.post('/', authMiddleware, roleMiddleware('admin'), createModule);
router.put('/:id', authMiddleware, roleMiddleware('admin'), updateModule);
router.delete('/:id', authMiddleware, roleMiddleware('admin'), deleteModule);

module.exports = router;
