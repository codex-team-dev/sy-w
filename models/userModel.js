const mongoose = require('mongoose');
const validator = require('validator');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const checkString = function(val) {
  return isNaN(+val);
}

const userSchema =  mongoose.Schema({
  name: {
    type: String,
    unique: true,
    required: [true, 'الرجاء ادخال الاسم'],
    minLength: [4, 'الاسم قصير جدا'],
    maxLength: [10, 'الاسم طويل جدا'],
    validate: {
      validator: checkString,
      message: 'يجب ان يحتوي الاسم على حروف'
    }
  },
  email: {
    type: String,
    unique: true,
    required: [true, 'الرجاء ادخال البريد الالكتروني'],
    validate: {
      validator: function(val) {
        return validator.isEmail(val);
      },
      message: 'هذا البريد غير صالح'
    }
  },
  password: {
    type: String,
    required: [true, 'الرجاء ادخال كلمة السر'],
    minLength: [8, 'يجب ان تكون كلمة السر اطول من ثمانية احرف'],
    maxLength: [30, 'كلمة السر طويلة جدا'],
    validate: {
      validator: checkString,
      message: 'يجب ان تحتوي كلمة السر على احرف'
    }
  },
  passwordConfirm: {
    type: String,
    required: [true, 'الرجاء تأكيد كلمة السر'],
    validate: {
      validator: function(val) {
        return this.password === val;
      },
      message: 'كلمات السر غير متطابقة'
    }
  },
  passwordChangedAt: {
    type: Date
  },
  studentId: {
  type: String,
  required: true,
  validate: {
    validator: function (v) {
      return /^09\d{8}$/.test(v); // starts with 09 + 8 more digits = total 10
    },
    message: "رقم غير صالح"
  }
},

parentPhone: {
  type: String,
  required: true,
  validate: {
    validator: function (v) {
      return /^09\d{8}$/.test(v); // same rule as studentId
    },
    message: "رقم غير صالح"
  }
},

dob: {
  type: String,
  required: true
  // You can store the raw value from <input type="date"> (YYYY-MM-DD)
},

referral: {
  type: String,
  required: true,
  enum: ["facebook", "instagram", "youtube", "friend"],
  message: "طريقة غير صالحة"
},
  role: {
    type: String,
    enum: {
      values: ['user', 'admin', 'supervisor'],
      message: 'لا يمكنك تغيير دورك'
    },
    default: 'user',
    select: false
  },
  active: {
    type: Boolean,
    default: true,
    select: false
  },
  passwordResetToken: {
    type: String,
    select: false
  },
  passwordResetTokenExpiresIn: {
    type: Date,
    select: false
  },
  value: {
    type: Number,
    default: 0
  },
  subcourses: [{
    type: mongoose.Schema.ObjectId,
    ref: 'Subcourse'
  }],
  // one-time telegram channel page shown after the first purchase
  telegramJoined: {
    type: Boolean,
    default: false
  },
  telegramOpenedAt: {
    type: Date,
    select: false
  },
  telegramInviteLink: {
    type: String,
    select: false
  },
  // official anki groups bought separately with ATP
  ankiGroups: [{
    type: mongoose.Schema.ObjectId,
    ref: 'AnkiGroup'
  }],
  screenWidth: {
    type: String
  },
  screenHeight: {
    type: String
  },
  userAgent: {
    type: String
  },
  reasonToBlock: {
    type: String
  },
  courseProgress: [{
  courseId: { type: mongoose.Schema.ObjectId, ref: "Subcourse" },
  achievedVideos: {
    achievedVideosCount: { type: Number, default: 0 },
    videoNumber: { type: Number, default: 0 },
    lessonNum: { type: Number, default: 1 }
  },
  achievedPercentage: { type: Number, default: 0 },
  lessons: [{
    _id: false,
    lessonNum: Number,
    videoNumber: { type: Number, default: 0 }
  }],
  lastLesson: Number
  }],
  notes: [{
    _id: {
      type: mongoose.Schema.ObjectId,
      default: () => new mongoose.Types.ObjectId()
    },
    subcourseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subcourse",
      required: [true, "ادخل اي دي الكورس"]
    },
    noteText: {
      type: String,
      required: [true, "ادخل الملاحظة"]
    },
    courseTitle: {
      type: String,
      required: [true, "ادخل عنوان الكورس"]
    },
    lessonTitle: {
      type: String,
      required: [true, "ادخل عنوان الدرس"]
    },
    videoTitle: {
      type: String,
      required: [true, "ادخل عنوان الفيديو"]
    },
    videoNum: {
      type: Number,
      required: [true, "ادخل رقم الفيديو"]
    },
    lessonNum: {
      type: Number,
      required: [true, "ادخل رقم الدرس"]
    },
    date: {
      type: Date,
      default: () => Date.now()
    },
    
  }],
  savedVideos: [{
    _id: {
      type: mongoose.Schema.ObjectId,
      default: () => new mongoose.Types.ObjectId()
    },
    subcourseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subcourse",
      required: [true, "ادخل اي دي الكورس"]
    },
    courseTitle: { type: String },
    lessonTitle: { type: String },
    videoTitle: { type: String },
    videoNum: {
      type: Number,
      required: [true, "ادخل رقم الفيديو"]
    },
    lessonNum: {
      type: Number,
      required: [true, "ادخل رقم الدرس"]
    },
    reason: {
      type: String,
      maxLength: [200, "سبب الحفظ طويل جدا"],
      default: ""
    },
    date: {
      type: Date,
      default: () => Date.now()
    }
  }]

})

userSchema.pre('save',async function(next) {
  if(!this.isModified('password')) return next();

  this.password = await bcrypt.hash(this.password, 12);
  this.passwordConfirm = undefined;
  if(!this.isNew)
  this.passwordChangedAt = new Date(Date.now() - 1000);

next();
});

userSchema.methods.correctPassword = async function(enteredPassword, hashedPassword) {
  return await bcrypt.compare(enteredPassword, hashedPassword);
}

userSchema.methods.checkChangedPassword = function(JWTIsuuedIn) {
  if(this.passwordChangedAt) {
    const changeDate = parseInt(this.passwordChangedAt / 1000, 10);
    if(changeDate > JWTIsuuedIn) return true;
  }

  return false;
};

userSchema.methods.createResetToken = async function() {
  const resetToken = crypto.randomBytes(32).toString('hex');

  this.passwordResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
  this.passwordResetTokenExpiresIn = new Date(Date.now() + (10 * 60 * 1000));

  await this.save({validateBeforeSave: false});

  return resetToken;
}

const User = mongoose.model('User', userSchema);
module.exports = User;