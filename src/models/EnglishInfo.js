const logger = require('../utils/logger').getLogger(__filename);
const Info = require('./Info');

/**
 * Class representing the Store Info structure for English content.
 */
class EnglishInfo extends Info {
  /**
   * Returns default values for English store information.
   * @returns {Object} Default store info structure
   */
  static getDefaults() {
    return {
      lang: 'en',
      showPrice: false,
      storeOpeningTime: "Sunday — Friday 10:00 AM — 6:00 PM",
      email: "majd.abbas2024@gmail.com",
      phone: "053-3919190",
      whatsappLink: "wa.me/+972533919190",
      location: "Alandlos Parquet Kafr Kanna",
      description: "Alandlos Parquet Kafr Kanna",
      showroomEyebrow: "visit our showroom",
      showroomTitle: "parking slot!",
      showroomDescription: "hi",
      contactEyebrow: "hi",
      contactTitle: "hi",
      contactDescription: "hi",
      heroEyebrow: "hi1",
      heroTitle: "hi1",
      heroDescription: "hi1",
      stats: [
        { value: "40+", label: "Years of Craft" },
        { value: "1,200+", label: "Floors Installed" },
        { value: "9", label: "Wood Collections" },
        { value: "4.9", label: "Average Rating" }
      ]
    };
  }
}

module.exports = EnglishInfo;
