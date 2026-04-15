const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const roleMiddleware = require('../middleware/roleMiddleware');
const {
  getCategories,
  createCategory,
  deleteCategory,
} = require('../controllers/categoryController');

const router = express.Router();

router.get('/', authMiddleware, getCategories);
router.post('/', authMiddleware, roleMiddleware('admin'), createCategory);
router.delete('/:id', authMiddleware, roleMiddleware('admin'), deleteCategory);

module.exports = router;
