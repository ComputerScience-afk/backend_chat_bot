require('dotenv').config();

const config = {
    meta: {
        apiVersion: 'v22.0',
        accessToken: process.env.META_ACCESS_TOKEN || 'EAAIZBmHNhTZCcBO5h2ztngAy85CdcVkyZAxtOeg93ZBW39ZBlwuAD7IJWUzEgoltpEZAjHn5jOIH54CtOrXPACXducHMtlZBYnotE6YNCCdFemZBTwOcBmjeI6BD7Jtc5jO8nphfWEA68ZAZC3440CNgq0xlnkFeQcZBGCq6PwbCDNmX2jaOUSSFHQ7dQAk',
        adAccountId: process.env.META_AD_ACCOUNT_ID || 'act_1219366595612290'
    },
    whatsapp: {
        apiUrl: process.env.WHATSAPP_API_URL || 'https://api.woztell.com',
        apiToken: process.env.WHATSAPP_API_TOKEN,
        phoneNumber: process.env.WHATSAPP_PHONE_NUMBER // El número al que se enviarán los mensajes
    },
    whatsappBusiness: {
        apiVersion: 'v17.0',
        accessToken: process.env.WHATSAPP_BUSINESS_TOKEN,
        phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
        // Opcional: Configuración adicional para webhooks si los implementamos después
        webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
    }
};

module.exports = config; 