const logger = require('../utils/logger').getLogger(__filename);
const Info = require('./Info');

/**
 * Class representing the Store Info structure for Arabic content.
 */
class ArabicInfo extends Info {
  /**
   * Returns default values for Arabic store information.
   * @returns {Object} Default store info structure
   */
  static getDefaults() {
    return {
      lang: 'ar',
      showPrice: false,
      storeOpeningTime: "الأحد — الجمعة 10:00 صباحًا — 6:00 مساءً",
      email: "majd.abbas2024@gmail.com",
      phone: "053-3919190",
      whatsappLink: "wa.me/+972533919190",
      location: "ألاندلوس باركيه كفر كنا",
      description: "ألاندلوس باركيه كفر كنا",
      showroomEyebrow: "زوروا صالة العرض",
      showroomTitle: "موقف سيارات!",
      showroomDescription: "مرحبًا",
      contactEyebrow: "مرحبًا",
      contactTitle: "مرحبًا",
      contactDescription: "مرحبًا",
      heroEyebrow: "مرحبًا 1",
      heroTitle: "مرحبًا 1",
      heroDescription: "مرحبًا 1",
      stats: [
        { value: "40+", label: "سنوات من الخبرة" },
        { value: "1,200+", label: "أرضيات مُركّبة" },
        { value: "9", label: "مجموعات خشبية" },
        { value: "4.9", label: "متوسط التقييم" }
      ]
    };
  }
}

module.exports = ArabicInfo;
