const { sequelize } = require('../connection');
const { logger } = require('../../../utils/logger');

// Importar modelos
const Lead = require('./Lead')(sequelize);
const CampaignLeadDetail = require('./CampaignLeadDetail')(sequelize);

// Definir relaciones
Lead.hasOne(CampaignLeadDetail, {
  foreignKey: 'lead_id',
  as: 'campaignDetails'
});

CampaignLeadDetail.belongsTo(Lead, {
  foreignKey: 'lead_id',
  as: 'lead'
});

// Función para sincronizar modelos
const syncModels = async (force = false) => {
  try {
    logger.info('Synchronizing database models...');
    await sequelize.sync({ force });
    logger.info('Database models synchronized successfully');
  } catch (error) {
    logger.error('Error synchronizing database models:', error);
    throw error;
  }
};

module.exports = {
  sequelize,
  Lead,
  CampaignLeadDetail,
  syncModels
}; 