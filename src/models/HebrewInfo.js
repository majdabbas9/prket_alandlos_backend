const logger = require('../utils/logger').getLogger(__filename);
const Info = require('./Info');

/**
 * Class representing the Store Info structure for Hebrew content.
 */
class HebrewInfo extends Info {
  /**
   * Returns default values for Hebrew store information.
   * @returns {Object} Default store info structure
   */
  static getDefaults() {
    return {
      lang: 'he',
      showPrice: false,
      storeOpeningTime: "ראשון — שישי 10:00 — 18:00",
      email: "majd.abbas2024@gmail.com",
      phone: "053-3919190",
      whatsappLink: "wa.me/+972533919190",
      location: "אלנדלוס פרקט כפר כנא",
      description: "אלנדלוס פרקט כפר כנא",
      showroomEyebrow: "בקרו באולם התצוגה",
      showroomTitle: "חניה!",
      showroomDescription: "היי",
      contactEyebrow: "היי",
      contactTitle: "היי",
      contactDescription: "היי",
      heroEyebrow: "היי 1",
      heroTitle: "היי 1",
      heroDescription: "היי 1",
      stats: [
        { value: "40+", label: "שנות ניסיון" },
        { value: "1,200+", label: "רצפות שהותקנו" },
        { value: "9", label: "קולקציות עץ" },
        { value: "4.9", label: "דירוג ממוצע" }
      ]
    };
  }
}

module.exports = HebrewInfo;
