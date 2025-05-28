const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const CampaignLeadDetail = sequelize.define('CampaignLeadDetail', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    lead_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'leads',
        key: 'id'
      }
    },
    id_campana: {
      type: DataTypes.STRING,
      allowNull: false
    },
    id_anuncio: {
      type: DataTypes.STRING,
      allowNull: false
    }
  }, {
    tableName: 'campaign_lead_details',
    underscored: true,
    timestamps: true,
    indexes: [
      {
        fields: ['lead_id']
      },
      {
        fields: ['id_campana']
      }
    ]
  });

  return CampaignLeadDetail;
}; 