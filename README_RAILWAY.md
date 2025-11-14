# دليل نشر المشروع على Railway

## خطوات النشر على Railway:

### 1. إنشاء حساب على Railway:
- اذهب إلى https://railway.app
- سجل دخول بحساب GitHub

### 2. إنشاء مشروع جديد:
- اضغط على "New Project"
- اختر "Deploy from GitHub repo" (إذا كان المشروع على GitHub)
- أو "Empty Project" ثم ارفع الملفات يدوياً

### 3. ربط المشروع بـ GitHub (موصى به):
- إذا كان المشروع على GitHub:
  - اختر "Deploy from GitHub repo"
  - اختر الـ repository
  - Railway سيكتشف `package.json` تلقائياً

### 4. إعدادات Railway:
- Railway يستخدم `PORT` من متغير البيئة تلقائياً
- لا حاجة لإعدادات إضافية

### 5. بعد النشر:
- احصل على رابط المشروع (مثل: `https://your-project.up.railway.app`)
- استخدمه في كود ESP32

## تحديث عنوان ESP32:

### في `esp32_cam_code.ino`:
```cpp
const char* serverURL = "https://your-project.up.railway.app/recognize";
```

### في `esp32_lcd_display.ino`:
```cpp
const char* serverURL = "https://your-project.up.railway.app/latest";
```

## Endpoints المتاحة:

- `GET /test` - اختبار السيرفر
- `GET /health` - حالة الصحة
- `POST /recognize` - التعرف على الصور (من ESP32-CAM)
- `GET /latest` - آخر نتيجة (لـ ESP32 LCD)

## المميزات:

- ✅ timeout أطول (15 دقيقة)
- ✅ ذاكرة كافية
- ✅ يدعم Node.js servers بشكل كامل
- ✅ خطة مجانية متاحة ($5 رصيد شهري)

## ملاحظات:

- Railway يستخدم `PORT` من متغير البيئة تلقائياً
- السيرفر يعمل بشكل مستمر (ليس serverless)
- النموذج يُحمل مرة واحدة فقط عند بدء السيرفر

