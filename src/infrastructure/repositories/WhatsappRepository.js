const axios = require('axios');

class WhatsappRepository {
    constructor(config) {
        this.apiUrl = config.apiUrl;
        this.apiToken = config.apiToken;
        this.phoneNumber = config.phoneNumber;
    }

    async checkMessageStatus(adId) {
        try {
            // Aquí implementarías la lógica para verificar el estado del mensaje en Woztell
            // Este es un ejemplo de cómo podría ser la estructura
            const response = await axios.get(
                `${this.apiUrl}/messages`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiToken}`
                    },
                    params: {
                        ad_id: adId,
                        phone_number: this.phoneNumber
                    }
                }
            );

            return {
                messageId: response.data.messageId,
                status: response.data.status,
                timestamp: response.data.timestamp,
                phoneNumber: this.phoneNumber
            };
        } catch (error) {
            throw new Error(`WhatsApp API Error: ${error.response?.data?.message || error.message}`);
        }
    }

    async sendMessage(phoneNumber, message) {
        try {
            const response = await axios.post(
                `${this.apiUrl}/messages`,
                {
                    phone_number: phoneNumber,
                    message: message
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiToken}`
                    }
                }
            );

            return {
                success: true,
                messageId: response.data.messageId,
                timestamp: response.data.timestamp
            };
        } catch (error) {
            throw new Error(`WhatsApp Send Message Error: ${error.response?.data?.message || error.message}`);
        }
    }
}

module.exports = WhatsappRepository; 