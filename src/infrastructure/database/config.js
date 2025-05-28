const { logger } = require('../../utils/logger');

// Función para parsear la URL de la base de datos
const parseDatabaseUrl = (url) => {
  try {
    const pattern = /^(mysql|postgres):\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)$/;
    const matches = url.match(pattern);
    
    if (!matches) {
      throw new Error('Invalid database URL format');
    }

    const [, dialect, username, password, host, port, database] = matches;

    return {
      username,
      password,
      database,
      host,
      port: parseInt(port, 10),
      dialect
    };
  } catch (error) {
    logger.error('Error parsing database URL:', error);
    throw error;
  }
};

// Configuración de la base de datos
const config = {
  development: {
    ...parseDatabaseUrl(process.env.DATABASE_URL || 'mysql://root:password@localhost:3306/whatsapp_bot'),
    logging: (msg) => logger.debug(msg),
    define: {
      timestamps: true,
      underscored: true
    },
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  },
  production: {
    ...parseDatabaseUrl(process.env.DATABASE_URL),
    logging: false,
    define: {
      timestamps: true,
      underscored: true
    },
    pool: {
      max: 10,
      min: 2,
      acquire: 30000,
      idle: 10000
    },
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    }
  }
};

module.exports = config; 