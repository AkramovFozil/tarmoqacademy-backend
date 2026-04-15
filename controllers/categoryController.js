const Category = require('../models/Category');
const Course = require('../models/Course');

const DEFAULT_CATEGORIES = [];

const normalizeCategoryPayload = (category) => ({
  id: category._id,
  name: category.name,
  slug: category.slug,
  description: category.description || '',
  isActive: Boolean(category.isActive),
  createdAt: category.createdAt,
});

const ensureDefaultCategories = async () => {};

const resolveCourseCategory = async ({ categoryId, category, fallbackToDefault = true }) => {
  await ensureDefaultCategories();

  if (categoryId) {
    const resolvedById = await Category.findById(categoryId);
    if (resolvedById) return resolvedById;
  }

  const normalizedCategory = String(category || '').trim();
  if (normalizedCategory) {
    const lowered = normalizedCategory.toLowerCase();
    const resolvedByName = await Category.findOne({
      $or: [
        { name: normalizedCategory },
        { slug: lowered.replace(/[^a-z0-9]+/g, '-') },
      ],
    });

    if (resolvedByName) return resolvedByName;
  }

  if (!fallbackToDefault) {
    return null;
  }

  return Category.findOne().sort({ createdAt: 1 });
};

const getCategories = async (req, res) => {
  try {
    await ensureDefaultCategories();

    const categories = await Category.find({ isActive: true }).sort({ createdAt: 1 });

    return res.status(200).json({
      success: true,
      count: categories.length,
      categories: categories.map(normalizeCategoryPayload),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const createCategory = async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const slug = String(req.body.slug || '').trim();
    const description = String(req.body.description || '').trim();

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Kategoriya nomi majburiy.',
      });
    }

    const category = await Category.create({
      name,
      slug,
      description,
      isActive: true,
    });

    return res.status(201).json({
      success: true,
      message: 'Kategoriya yaratildi.',
      category: normalizeCategoryPayload(category),
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Bu nom yoki slug bilan kategoriya allaqachon mavjud.',
      });
    }

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const deleteCategory = async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Kategoriya topilmadi.',
      });
    }

    const linkedCourses = await Course.countDocuments({
      $or: [
        { categoryId: category._id },
        { category: category.name },
        { category: category.slug },
      ],
    });

    if (linkedCourses > 0) {
      return res.status(400).json({
        success: false,
        message: 'Bu kategoriyaga kurslar biriktirilgan. Avval kurslarni boshqa kategoriyaga otkazing.',
      });
    }

    await category.deleteOne();

    return res.status(200).json({
      success: true,
      message: 'Kategoriya ochirildi.',
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  DEFAULT_CATEGORIES,
  ensureDefaultCategories,
  resolveCourseCategory,
  getCategories,
  createCategory,
  deleteCategory,
};
