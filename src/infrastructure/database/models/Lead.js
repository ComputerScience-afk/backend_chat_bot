const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Lead = sequelize.define('Lead', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    fecha: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    hora: {
      type: DataTypes.TIME,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    telefono: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    nombre: {
      type: DataTypes.STRING,
      allowNull: true
    },
    ubicacion: {
      type: DataTypes.STRING,
      allowNull: true
    },
    sintomas: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: ''
    },
    origen: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'whatsapp'
    },
    primera_interaccion: {
      type: DataTypes.DATE,
      allowNull: false
    },
    ultima_interaccion: {
      type: DataTypes.DATE,
      allowNull: false
    },
    ultima_consulta: {
      type: DataTypes.DATE,
      allowNull: true
    },
    is_bot_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    tipo_lead: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'organic'
    }
  }, {
    tableName: 'leads',
    underscored: true,
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['telefono']
      }
    ]
  });

  Lead.associate = (models) => {
    Lead.hasOne(models.CampaignLeadDetail, {
      foreignKey: 'lead_id',
      as: 'campaignDetails'
    });
  };

  return Lead;
}; 