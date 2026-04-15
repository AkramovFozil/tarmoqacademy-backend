const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const connectDB = require('./config/db');

const Category = require('./models/Category');
const Course = require('./models/Course');
const Module = require('./models/Module');
const Lesson = require('./models/Lesson');
const Progress = require('./models/Progress');
const Purchase = require('./models/Purchase');
const Certificate = require('./models/Certificate');
const TaskSubmission = require('./models/TaskSubmission');
const UserProgress = require('./models/UserProgress');
const User = require('./models/User');

const CATEGORY_NAME = 'AI & Zamonaviy Kasblar';

const courseBlueprint = {
  title: 'AI Mastery: 0 dan Pro darajagacha',
  description:
    "AI tools, botlar, assistant va website yaratishni 0 dan professional darajagacha olib chiqadigan flagship kurs. Kurs tarkibida 15 ta dars va 4 ta jonli webinar mavjud.",
  price: 99000,
  isPublished: true,
  modules: [
    {
      title: 'AI Asoslari',
      lessons: [
        {
          title: 'AI mindset va kurs yonalishi',
          duration: 18,
          content:
            "AI ekotizimi, zamonaviy kasblardagi orni va kurs davomida qanday natijaga chiqishingizni tushuntiradi.",
        },
        {
          title: 'ChatGPT sozlash',
          duration: 22,
          content:
            "ChatGPT akkauntini togri sozlash, custom instruction, fayl ishlatish va ish jarayoniga mos profil yaratish.",
        },
        {
          title: 'Prompt engineering',
          duration: 24,
          content:
            "Prompt struktura, rol berish, context bilan ishlash va natijani iterativ yaxshilash usullari.",
          task:
            "Bir xil vazifa uchun 3 xil prompt yozing va qaysi biri kuchliroq ishlaganini qisqa izohlang.",
        },
      ],
    },
    {
      title: 'AI Tools',
      lessons: [
        {
          title: 'Image AI workflow',
          duration: 20,
          content:
            "Rasm yaratish, stilni boshqarish va marketing yoki kontent ishlab chiqarish uchun AI vizual workflow qurish.",
        },
        {
          title: 'Video va music AI',
          duration: 23,
          content:
            "Qisqa video, voiceover va music generation vositalarini bitta pipeline ichida ishlatish.",
        },
        {
          title: 'Integrations',
          duration: 26,
          content:
            "No-code va low-code integratsiyalar orqali AI servislarni Telegram, email va CRM oqimlariga ulash.",
          task:
            "Ozingizga kerak bolgan 1 ta automation flow chizib, qaysi servislar ulanishini yozing.",
        },
      ],
    },
    {
      title: 'Botlar',
      lessons: [
        {
          title: 'Telegram bot arxitekturasi',
          duration: 19,
          content:
            "Telegram bot uchun foydalanuvchi oqimi, komandalar va malumot almashish strukturasini loyihalash.",
        },
        {
          title: 'Telegram bot yaratish',
          duration: 27,
          content:
            "BotFather sozlamalari, webhook yoki polling yondashuvi va foydali komandalarni yaratish.",
        },
        {
          title: 'AI agent',
          duration: 29,
          content:
            "AI agent uchun memory, tools va task execution zanjirini tuzish hamda real use-case bilan ishlash.",
          task:
            "Sotuv, support yoki shaxsiy yordamchi uchun bitta AI agent ssenariysini yozing.",
        },
      ],
    },
    {
      title: 'Real Project',
      lessons: [
        {
          title: 'Project blueprint va scope',
          duration: 17,
          content:
            "Flagship loyiha uchun talablar, foydalanuvchi senariylari va MVP scope ni belgilash.",
        },
        {
          title: 'Personal assistant',
          duration: 28,
          content:
            "Vazifa boshqaruvi, javob shablonlari va shaxsiy samaradorlik uchun AI assistant yigish.",
        },
        {
          title: 'Website',
          duration: 30,
          content:
            "Landing page yoki service website ni AI yordamida copy, struktura va prototip bilan tez chiqarish.",
          task:
            "Tanlangan niche uchun assistant yoki website konseptini tayyorlab, asosiy sahifalarini sanang.",
        },
      ],
    },
    {
      title: 'Webinarlar',
      lessons: [
        {
          title: 'Zoom Session 1: Kickoff',
          duration: 60,
          content:
            "Kurs roadmap, savol-javob va AI bozoridagi imkoniyatlarni tahlil qilish uchun live kickoff sessiya.",
        },
        {
          title: 'Zoom Session 2: Tool Stack',
          duration: 75,
          content:
            "Image, video, music va automation stack boyicha amaliy demo va ishtirokchilar caselari.",
        },
        {
          title: 'Zoom Session 3: Project Review',
          duration: 90,
          content:
            "Ishtirokchilar loyihalarini korib chiqish, feedback berish va 4-webinar final sessiyaga tayyorgarlik.",
        },
      ],
    },
  ],
};

const seed = async () => {
  await connectDB();

  await Promise.all([
    Course.deleteMany({}),
    Module.deleteMany({}),
    Lesson.deleteMany({}),
    Category.deleteMany({}),
    Progress.deleteMany({}),
    Purchase.deleteMany({}),
    Certificate.deleteMany({}),
    TaskSubmission.deleteMany({}),
    UserProgress.deleteMany({}),
    User.updateMany(
      {},
      {
        $set: {
          courses: [],
          enrolledCourses: [],
          purchasedCourses: [],
        },
      }
    ),
  ]);

  console.log('Cleared LMS content and related references.');

  const category = await Category.create({
    name: CATEGORY_NAME,
    description: "AI, avtomatlashtirish va zamonaviy digital kasblar uchun flagship yonalish.",
    isActive: true,
  });

  const adminUser = await User.findOne({ role: 'admin' }).select('_id');

  const course = await Course.create({
    title: courseBlueprint.title,
    description: courseBlueprint.description,
    category: category.name,
    categoryId: category._id,
    instructor: adminUser?._id,
    price: courseBlueprint.price,
    isPublished: courseBlueprint.isPublished,
  });

  let totalLessons = 0;

  for (const [moduleIndex, moduleData] of courseBlueprint.modules.entries()) {
    const module = await Module.create({
      courseId: course._id,
      title: moduleData.title,
      order: moduleIndex + 1,
    });

    const lessons = moduleData.lessons.map((lesson, lessonIndex) => ({
      moduleId: module._id,
      title: lesson.title,
      content: lesson.content,
      task: lesson.task || '',
      duration: lesson.duration,
      order: lessonIndex + 1,
    }));

    totalLessons += lessons.length;
    await Lesson.insertMany(lessons);
  }

  console.log('Created category, flagship course, 5 modules and 15 lessons.');
  console.log(`Category: ${category.name}`);
  console.log(`Course: ${course.title}`);
  console.log(`Modules: ${courseBlueprint.modules.length}`);
  console.log(`Lessons: ${totalLessons}`);

  process.exit(0);
};

seed().catch((error) => {
  console.error('Seed error:', error);
  process.exit(1);
});
