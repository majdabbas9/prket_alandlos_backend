const logger = require('../utils/logger').getLogger(__filename);

/**
 * Class representing the Store Info structure.
 */
class Info {
  /**
   * @param {Object} [data={}] - Initial store info data
   */
  constructor(data = {}) {
    const defaults = this.constructor.getDefaults();
    const merged = { ...defaults, ...data };

    this.lang = merged.lang !== undefined ? String(merged.lang) : defaults.lang;

    this.showPrice = typeof merged.showPrice === 'boolean'
      ? merged.showPrice
      : (merged.showPrice === 'true' ? true : (merged.showPrice === 'false' ? false : defaults.showPrice));
    this.storeOpeningTime = merged.storeOpeningTime !== undefined ? String(merged.storeOpeningTime) : defaults.storeOpeningTime;
    this.email = merged.email !== undefined ? String(merged.email) : defaults.email;
    this.phone = merged.phone !== undefined ? String(merged.phone) : defaults.phone;
    this.whatsappLink = merged.whatsappLink !== undefined ? String(merged.whatsappLink) : defaults.whatsappLink;
    this.location = merged.location !== undefined ? String(merged.location) : defaults.location;
    this.description = merged.description !== undefined ? String(merged.description) : defaults.description;
    this.showroomEyebrow = merged.showroomEyebrow !== undefined ? String(merged.showroomEyebrow) : defaults.showroomEyebrow;
    this.showroomTitle = merged.showroomTitle !== undefined ? String(merged.showroomTitle) : defaults.showroomTitle;
    this.showroomDescription = merged.showroomDescription !== undefined ? String(merged.showroomDescription) : defaults.showroomDescription;
    this.contactEyebrow = merged.contactEyebrow !== undefined ? String(merged.contactEyebrow) : defaults.contactEyebrow;
    this.contactTitle = merged.contactTitle !== undefined ? String(merged.contactTitle) : defaults.contactTitle;
    this.contactDescription = merged.contactDescription !== undefined ? String(merged.contactDescription) : defaults.contactDescription;
    
    if (merged.heroEyebrow !== undefined) this.heroEyebrow = String(merged.heroEyebrow);
    if (merged.heroTitle !== undefined) this.heroTitle = String(merged.heroTitle);
    if (merged.heroDescription !== undefined) this.heroDescription = String(merged.heroDescription);

    this.stats = Array.isArray(merged.stats) ? merged.stats : defaults.stats;
  }

  /**
   * Returns default values for store information.
   * Abstract method - must be overridden by language-specific subclasses.
   * @returns {Object} Default store info structure
   */
  static getDefaults() {
    throw new Error('Info is abstract; use EnglishInfo, ArabicInfo, or HebrewInfo');
  }

  /**
   * Update properties using a partial data object.
   * @param {Object} updateData - Data containing fields to update
   * @returns {Info} Updated instance
   */
  update(updateData = {}) {
    logger.info({ fieldsUpdated: Object.keys(updateData) }, 'Updating Info model instance properties');
    if (updateData.showPrice !== undefined) {
      this.showPrice = typeof updateData.showPrice === 'boolean'
        ? updateData.showPrice
        : (updateData.showPrice === 'true' ? true : (updateData.showPrice === 'false' ? false : this.showPrice));
    }
    if (updateData.storeOpeningTime !== undefined) this.storeOpeningTime = String(updateData.storeOpeningTime);
    if (updateData.email !== undefined) this.email = String(updateData.email);
    if (updateData.phone !== undefined) this.phone = String(updateData.phone);
    if (updateData.whatsappLink !== undefined) this.whatsappLink = String(updateData.whatsappLink);
    if (updateData.location !== undefined) this.location = String(updateData.location);
    if (updateData.description !== undefined) this.description = String(updateData.description);
    if (updateData.showroomEyebrow !== undefined) this.showroomEyebrow = String(updateData.showroomEyebrow);
    if (updateData.showroomTitle !== undefined) this.showroomTitle = String(updateData.showroomTitle);
    if (updateData.showroomDescription !== undefined) this.showroomDescription = String(updateData.showroomDescription);
    if (updateData.contactEyebrow !== undefined) this.contactEyebrow = String(updateData.contactEyebrow);
    if (updateData.contactTitle !== undefined) this.contactTitle = String(updateData.contactTitle);
    if (updateData.contactDescription !== undefined) this.contactDescription = String(updateData.contactDescription);
    if (updateData.heroEyebrow !== undefined) this.heroEyebrow = String(updateData.heroEyebrow);
    if (updateData.heroTitle !== undefined) this.heroTitle = String(updateData.heroTitle);
    if (updateData.heroDescription !== undefined) this.heroDescription = String(updateData.heroDescription);
    if (updateData.stats !== undefined) this.stats = updateData.stats;
    
    return this;
  }

  /**
   * Return plain JavaScript object representation.
   * @returns {Object}
   */
  toJSON() {
    const obj = {
      lang: this.lang,
      showPrice: this.showPrice,
      storeOpeningTime: this.storeOpeningTime,
      email: this.email,
      phone: this.phone,
      whatsappLink: this.whatsappLink,
      location: this.location,
      description: this.description,
      showroomEyebrow: this.showroomEyebrow,
      showroomTitle: this.showroomTitle,
      showroomDescription: this.showroomDescription,
      contactEyebrow: this.contactEyebrow,
      contactTitle: this.contactTitle,
      contactDescription: this.contactDescription,
      stats: this.stats
    };

    if (this.heroEyebrow !== undefined) obj.heroEyebrow = this.heroEyebrow;
    if (this.heroTitle !== undefined) obj.heroTitle = this.heroTitle;
    if (this.heroDescription !== undefined) obj.heroDescription = this.heroDescription;

    return obj;
  }

  /**
   * Instantiate an Info instance from raw JSON object or string.
   * @param {Object|string} input 
   * @returns {Info}
   */
  static fromJSON(input) {
    if (!input) {
      logger.info('fromJSON called with empty input, returning default instance');
      return new this();
    }
    if (typeof input === 'string') {
      try {
        const parsed = JSON.parse(input);
        logger.info('Successfully parsed Info JSON string');
        return new this(parsed);
      } catch (e) {
        logger.error({ err: e }, 'Failed to parse Info JSON string, falling back to default instance');
        return new this();
      }
    }
    return new this(input);
  }
}

module.exports = Info;

