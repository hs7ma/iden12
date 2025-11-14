const express = require('express');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const tf = require('@tensorflow/tfjs');
const cocoSsd = require('@tensorflow-models/coco-ssd');
const sharp = require('sharp');

const app = express();
// استخدام PORT من متغير البيئة (Railway/Glitch يستخدم PORT) أو 3000 كافتراضي
const PORT = process.env.PORT || 3000;

// متغير لحفظ آخر نتيجة تعرف
let lastRecognitionResult = {
  object: 'في انتظار...',
  confidence: '0.00',
  timestamp: Date.now(),
  message: 'في انتظار أول صورة'
};

// إعداد CORS للسماح لـ ESP32 بالاتصال
app.use(cors());

// middleware لاستقبال الصور كـ raw binary من ESP32 (فقط لـ /recognize)
// نسمح بأي نوع محتوى لأن بعض المكتبات تضيف charset للرأس
app.use('/recognize', express.raw({ 
  type: '*/*',
  limit: '10mb' 
}));

// middleware لـ JSON (للباقي)
app.use(express.json());

// إعداد multer لحفظ الصور المرفوعة
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = './uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `image_${Date.now()}.jpg`);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// متغير لحفظ النموذج بعد تحميله
let model = null;

// دالة لتحميل نموذج COCO-SSD
async function loadModel() {
  try {
    console.log('جارٍ تحميل نموذج COCO-SSD...');
    model = await cocoSsd.load();
    console.log('تم تحميل النموذج بنجاح!');
    return model;
  } catch (error) {
    console.error('خطأ في تحميل النموذج:', error);
    throw error;
  }
}

// قاموس لترجمة أسماء الأشياء من الإنجليزية إلى العربية
const objectTranslations = {
  'person': 'شخص',
  'bicycle': 'دراجة',
  'car': 'سيارة',
  'motorcycle': 'دراجة نارية',
  'airplane': 'طائرة',
  'bus': 'حافلة',
  'train': 'قطار',
  'truck': 'شاحنة',
  'boat': 'قارب',
  'traffic light': 'إشارة مرور',
  'fire hydrant': 'صنبور إطفاء',
  'stop sign': 'علامة توقف',
  'parking meter': 'عداد وقوف',
  'bench': 'مقعد',
  'bird': 'طائر',
  'cat': 'قطة',
  'dog': 'كلب',
  'horse': 'حصان',
  'sheep': 'خروف',
  'cow': 'بقرة',
  'elephant': 'فيل',
  'bear': 'دب',
  'zebra': 'حمار وحشي',
  'giraffe': 'زرافة',
  'backpack': 'حقيبة ظهر',
  'umbrella': 'مظلة',
  'handbag': 'حقيبة يد',
  'tie': 'ربطة عنق',
  'suitcase': 'حقيبة سفر',
  'frisbee': 'فريسبي',
  'skis': 'مزالج',
  'snowboard': 'لوح تزلج',
  'sports ball': 'كرة رياضية',
  'kite': 'طائرة ورقية',
  'baseball bat': 'مضرب بيسبول',
  'baseball glove': 'قفاز بيسبول',
  'skateboard': 'لوح تزلج',
  'surfboard': 'لوح ركمجة',
  'tennis racket': 'مضرب تنس',
  'bottle': 'زجاجة',
  'wine glass': 'كأس نبيذ',
  'cup': 'كوب',
  'fork': 'شوكة',
  'knife': 'سكين',
  'spoon': 'ملعقة',
  'bowl': 'وعاء',
  'banana': 'موز',
  'apple': 'تفاح',
  'sandwich': 'ساندويتش',
  'orange': 'برتقال',
  'broccoli': 'بروكلي',
  'carrot': 'جزر',
  'hot dog': 'هوت دوغ',
  'pizza': 'بيتزا',
  'donut': 'دونات',
  'cake': 'كعكة',
  'chair': 'كرسي',
  'couch': 'أريكة',
  'potted plant': 'نبات',
  'bed': 'سرير',
  'dining table': 'طاولة طعام',
  'toilet': 'مرحاض',
  'tv': 'تلفاز',
  'laptop': 'لابتوب',
  'mouse': 'فأرة',
  'remote': 'جهاز تحكم',
  'keyboard': 'لوحة مفاتيح',
  'cell phone': 'هاتف',
  'microwave': 'ميكروويف',
  'oven': 'فرن',
  'toaster': 'محمصة',
  'sink': 'حوض',
  'refrigerator': 'ثلاجة',
  'book': 'كتاب',
  'clock': 'ساعة',
  'vase': 'مزهرية',
  'scissors': 'مقص',
  'teddy bear': 'دب محشو',
  'hair drier': 'مجفف شعر',
  'toothbrush': 'فرشاة أسنان'
};

// دالة لترجمة اسم الشيء إلى العربية
function translateObject(objectName) {
  return objectTranslations[objectName.toLowerCase()] || objectName;
}

// دالة للتعرف على الصورة باستخدام TensorFlow.js و COCO-SSD
async function recognizeImage(imagePath) {
  try {
    if (!model) {
      throw new Error('النموذج غير محمل');
    }

    console.log('جارٍ معالجة الصورة...');
    
    // قراءة الصورة وتحويلها إلى buffer
    const imageBuffer = await fs.promises.readFile(imagePath);
    
    // تقليل حجم الصورة أولاً لتسريع المعالجة (مهم لـ Glitch)
    // إذا كانت الصورة كبيرة جداً، نضغطها أولاً
    let processedBuffer = imageBuffer;
    const metadata = await sharp(imageBuffer).metadata();
    
    // إذا كانت الصورة أكبر من 2MB، نضغطها أولاً
    if (imageBuffer.length > 2 * 1024 * 1024) {
      console.log(`ضغط الصورة من ${(imageBuffer.length / 1024).toFixed(0)}KB...`);
      processedBuffer = await sharp(imageBuffer)
        .resize(Math.min(metadata.width, 1280), Math.min(metadata.height, 1280), { 
          fit: 'inside',
          withoutEnlargement: true 
        })
        .jpeg({ quality: 85 })
        .toBuffer();
      console.log(`تم ضغط الصورة إلى ${(processedBuffer.length / 1024).toFixed(0)}KB`);
    }
    
    // تحسين الصورة قبل المعالجة
    // تحويل الصورة إلى RGB وتحسينها باستخدام sharp
    const { data, info } = await sharp(processedBuffer)
      .resize(640, 640, { 
        fit: 'fill',  // fill بدلاً من inside لضمان الحجم المحدد
        kernel: sharp.kernel.lanczos3  // استخدام kernel أفضل للجودة
      })
      .normalize()  // تحسين التباين والإضاءة
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    
    console.log(`حجم الصورة المعالجة: ${info.width}x${info.height}`);

    // التحقق من أن البيانات صحيحة
    const expectedSize = info.height * info.width * 3;
    if (data.length !== expectedSize) {
      throw new Error(`حجم البيانات غير متطابق: ${data.length} vs ${expectedSize}`);
    }

    // تحويل Buffer إلى Array ثم إلى tensor3d
    // الشكل المطلوب: [height, width, 3] للصور RGB
    const pixelData = Array.from(data);
    const imageTensor = tf.tensor3d(
      pixelData,
      [info.height, info.width, 3],
      'int32'
    );
    
    // COCO-SSD يعمل بشكل أفضل مع صور بحجم 640x640 أو أكبر
    // إعادة تحجيم الصورة إلى 640x640 إذا كانت أصغر
    let tensorForModel = imageTensor;
    if (info.height !== 640 || info.width !== 640) {
      console.log(`إعادة تحجيم من ${info.width}x${info.height} إلى 640x640`);
      // resizeBilinear يحول إلى float32، لذا نحتاج لإرجاعه إلى int32
      const resized = tf.image.resizeBilinear(imageTensor, [640, 640], true);
      // تحويل القيم من [0-1] إلى [0-255] وإرجاعها إلى int32
      tensorForModel = resized.mul(255).toInt();
      resized.dispose();
      imageTensor.dispose(); // تنظيف tensor الأصلي
    }
    
    console.log(`شكل Tensor قبل الإرسال: [${tensorForModel.shape.join(', ')}]`);
    console.log(`نوع البيانات: ${tensorForModel.dtype}`);
    console.log(`نطاق القيم: min=${(await tensorForModel.min().data())[0]}, max=${(await tensorForModel.max().data())[0]}`);

    // التعرف على الأشياء في الصورة
    console.log('جارٍ التعرف على الأشياء...');
    
    // COCO-SSD يتوقع tensor3d [height, width, 3] وليس tensor4d
    // إذا كان tensor4d، نحتاج لإزالة batch dimension
    let finalTensor = tensorForModel;
    if (tensorForModel.shape.length === 4) {
      // إزالة batch dimension: [1, h, w, 3] -> [h, w, 3]
      finalTensor = tensorForModel.squeeze([0]);
    }
    
    // إضافة timeout للتعرف (مهم لـ Glitch)
    const detectPromise = model.detect(finalTensor);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Timeout: التعرف استغرق وقتاً طويلاً')), 25000)
    );
    
    const predictions = await Promise.race([detectPromise, timeoutPromise]);
    
    // تنظيف الذاكرة فوراً
    if (finalTensor !== tensorForModel) {
      finalTensor.dispose();
    }
    if (tensorForModel !== imageTensor) {
      tensorForModel.dispose();
    } else {
      imageTensor.dispose();
    }
    
    // تنظيف الذاكرة من TensorFlow (اختياري - يساعد في تقليل استهلاك الذاكرة)
    try {
      tf.engine().startScope();
      tf.engine().endScope();
    } catch (e) {
      // تجاهل الأخطاء في تنظيف الذاكرة
    }

    if (!predictions || predictions.length === 0) {
      console.log('⚠️ لم يتم التعرف على أي شيء في الصورة');
      console.log('💡 نصائح:');
      console.log('   - تأكد من وجود أشياء واضحة في الصورة');
      console.log('   - تحقق من الإضاءة (يجب أن تكون جيدة)');
      console.log('   - تأكد من أن الصورة واضحة وغير ضبابية');
      return {
        object: 'لا شيء',
        confidence: '0.00',
        message: 'لم يتم التعرف على أي شيء في الصورة. تأكد من وجود أشياء واضحة وإضاءة جيدة.'
      };
    }
    
    console.log(`✓ تم العثور على ${predictions.length} كائن(ات) محتمل(ة)`);

    // الحصول على أفضل نتيجة (أعلى ثقة)
    const bestPrediction = predictions.reduce((best, current) => 
      current.score > best.score ? current : best
    );

    const objectName = translateObject(bestPrediction.class);
    const confidence = bestPrediction.score.toFixed(2);

    // إذا كان هناك أكثر من كائن، أضف معلومات إضافية
    let message = `تم التعرف على: ${objectName} (دقة: ${confidence})`;
    if (predictions.length > 1) {
      const otherObjects = predictions
        .slice(0, 3)
        .map(p => `${translateObject(p.class)} (${p.score.toFixed(2)})`)
        .join(', ');
      message += ` | أخرى: ${otherObjects}`;
    }

    console.log(`تم التعرف على ${predictions.length} كائن(ات)`);
    console.log(`أفضل نتيجة: ${objectName} - ${confidence}`);

    return {
      object: objectName,
      confidence: confidence,
      message: message,
      allDetections: predictions.map(p => ({
        object: translateObject(p.class),
        confidence: p.score.toFixed(2)
      }))
    };
  } catch (error) {
    console.error('خطأ في التعرف على الصورة:', error);
    return {
      object: 'غير معروف',
      confidence: '0.00',
      message: `فشل التعرف: ${error.message}`
    };
  }
}

// نقطة النهاية لاستقبال الصور من ESP32
// رسالة توضيحية عند الوصول إلى /recognize بـ GET
app.get('/recognize', (req, res) => {
  res.status(405).json({
    success: false,
    message: 'هذا الـ endpoint يستخدم POST فقط',
    method: 'يجب استخدام POST لإرسال الصورة',
    example: 'أرسل صورة JPEG كـ raw binary data في body الطلب',
    endpoints: {
      test: 'GET /test',
      health: 'GET /health',
      recognize: 'POST /recognize',
      latest: 'GET /latest'
    }
  });
});

app.post('/recognize', async (req, res) => {
  let tempImagePath = null;
  
  try {
    // التحقق من وجود بيانات الصورة
    if (!req.body || req.body.length === 0) {
      console.error('❌ لم يتم إرسال بيانات الصورة');
      return res.status(400).json({ 
        success: false, 
        message: 'لم يتم إرسال صورة' 
      });
    }

    // التحقق من أن البيانات هي صورة JPEG صالحة (تبدأ بـ FF D8)
    const imageBuffer = Buffer.from(req.body);
    if (imageBuffer.length < 2 || imageBuffer[0] !== 0xFF || imageBuffer[1] !== 0xD8) {
      console.error(`❌ الصورة غير صالحة - الحجم: ${imageBuffer.length} bytes`);
      console.error(`   البايتات الأولى: ${imageBuffer[0].toString(16)} ${imageBuffer[1].toString(16)}`);
      return res.status(400).json({ 
        success: false, 
        message: 'الصورة المرسلة ليست بصيغة JPEG صالحة' 
      });
    }

    // التحقق من حجم الصورة (يجب أن تكون على الأقل 1KB)
    if (imageBuffer.length < 1024) {
      console.error(`❌ الصورة صغيرة جداً: ${imageBuffer.length} bytes`);
      return res.status(400).json({ 
        success: false, 
        message: `الصورة صغيرة جداً (${imageBuffer.length} bytes). تأكد من أن الكاميرا تعمل بشكل صحيح.` 
      });
    }

    // حفظ الصورة مؤقتاً
    // استخدام /tmp على Glitch أو uploads محلياً
    const useTmp = process.platform !== 'win32' && fs.existsSync('/tmp');
    const tempDir = useTmp ? '/tmp' : path.join(__dirname, 'uploads');
    
    // التأكد من وجود المجلد
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    tempImagePath = path.join(tempDir, `temp_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`);
    
    // حفظ الصورة
    await fs.promises.writeFile(tempImagePath, imageBuffer);
    
    console.log(`✓ تم استقبال صورة صالحة بحجم: ${imageBuffer.length} bytes`);
    
    // التحقق من أن الصورة يمكن قراءتها باستخدام sharp
    try {
      const metadata = await sharp(tempImagePath).metadata();
      console.log(`   الأبعاد: ${metadata.width}x${metadata.height}, التنسيق: ${metadata.format}`);
    } catch (sharpError) {
      console.error('❌ خطأ في قراءة الصورة:', sharpError.message);
      return res.status(400).json({ 
        success: false, 
        message: `فشل قراءة الصورة: ${sharpError.message}` 
      });
    }
    
    // التعرف على الصورة
    const result = await recognizeImage(tempImagePath);
    
    // حذف الصورة بعد المعالجة لتوفير المساحة
    if (fs.existsSync(tempImagePath)) {
      fs.unlinkSync(tempImagePath);
    }
    
    console.log(`النتيجة: ${result.message}`);
    
    // حفظ آخر نتيجة
    lastRecognitionResult = {
      object: result.object,
      confidence: result.confidence,
      timestamp: Date.now(),
      message: result.message
    };
    
    // إرسال النتيجة إلى ESP32-CAM
    res.json({
      success: true,
      object: result.object,
      confidence: result.confidence,
      message: result.message
    });
    
  } catch (error) {
    // حذف الملف المؤقت في حالة الخطأ
    if (tempImagePath && fs.existsSync(tempImagePath)) {
      try {
        fs.unlinkSync(tempImagePath);
      } catch (unlinkError) {
        console.error('خطأ في حذف الملف المؤقت:', unlinkError);
      }
    }
    
    console.error('خطأ في معالجة الصورة:', error);
    res.status(500).json({ 
      success: false, 
      message: 'خطأ في معالجة الصورة',
      error: error.message 
    });
  }
});

// نقطة نهاية للصفحة الرئيسية
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.json({
      status: 'السيرفر يعمل',
      message: 'مرحباً من سيرفر التعرف على الصور',
      endpoints: {
        test: '/test',
        health: '/health',
        recognize: 'POST /recognize',
        latest: '/latest'
      }
    });
  }
});

// نقطة نهاية للاختبار
app.get('/test', (req, res) => {
  res.json({ 
    status: 'السيرفر يعمل بشكل صحيح',
    message: 'مرحباً من سيرفر التعرف على الصور',
    modelLoaded: model !== null,
    platform: process.platform,
    nodeVersion: process.version
  });
});

// نقطة نهاية للصحة (Health Check) - مهمة لـ Glitch
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    modelLoaded: model !== null,
    timestamp: Date.now(),
    uptime: process.uptime()
  });
});

// نقطة نهاية للحصول على آخر نتيجة (لـ ESP32 مع LCD)
app.get('/latest', (req, res) => {
  res.json({
    success: true,
    object: lastRecognitionResult.object,
    confidence: lastRecognitionResult.confidence,
    timestamp: lastRecognitionResult.timestamp,
    message: lastRecognitionResult.message,
    age: Date.now() - lastRecognitionResult.timestamp  // عمر النتيجة بالمللي ثانية
  });
});

// بدء السيرفر بعد تحميل النموذج
async function startServer() {
  try {
    // تحميل النموذج قبل بدء السيرفر
    await loadModel();
    
    const host = process.env.HOST || '0.0.0.0';
    app.listen(PORT, host, () => {
      console.log(`✓ السيرفر يعمل على ${host}:${PORT}`);
      console.log(`✓ افتح http://localhost:${PORT}/test للاختبار`);
      console.log(`✓ Health check: http://localhost:${PORT}/health`);
      console.log('✓ النموذج جاهز للتعرف على الصور!');
      console.log(`✓ Platform: ${process.platform}`);
      console.log(`✓ Node version: ${process.version}`);
    });
  } catch (error) {
    console.error('فشل في بدء السيرفر:', error);
    process.exit(1);
  }
}

// بدء السيرفر
startServer();

