const axios = require('axios');

class WhatsAppBusinessRepository {
    constructor(config) {
        this.apiVersion = config.apiVersion || 'v17.0';
        this.accessToken = config.accessToken;
        this.phoneNumberId = config.phoneNumberId;
        this.baseUrl = `https://graph.facebook.com/${this.apiVersion}`;
    }

    async getLeadsByAdId(adId, startDate, endDate) {
        try {
            // Obtener mensajes del día especificado
            const response = await axios.get(
                `${this.baseUrl}/${this.phoneNumberId}/messages`,
                {
                    params: {
                        access_token: this.accessToken,
                        fields: 'from,timestamp,metadata,type',
                        // Filtrar por rango de fecha
                        filtering: JSON.stringify([{
                            field: 'timestamp',
                            operator: 'BETWEEN',
                            value: [
                                new Date(startDate).getTime() / 1000,
                                new Date(endDate).getTime() / 1000
                            ]
                        }])
                    }
                }
            );

            // Filtrar mensajes iniciales (leads) que provienen del anuncio específico
            const leads = response.data.data.filter(message => {
                return message.metadata?.source_id === adId && 
                       message.type === 'text' &&
                       !message.context; // Los mensajes sin context son mensajes iniciales
            });

            return {
                total_leads: leads.length,
                leads: leads.map(lead => ({
                    timestamp: lead.timestamp,
                    from: lead.from,
                    source_id: lead.metadata?.source_id
                }))
            };

        } catch (error) {
            throw new Error(`WhatsApp Business API Error: ${error.response?.data?.error?.message || error.message}`);
        }
    }

    async getBusinessProfile() {
        try {
            const response = await axios.get(
                `${this.baseUrl}/${this.phoneNumberId}/whatsapp_business_profile`,
                {
                    params: {
                        access_token: this.accessToken,
                        fields: 'about,email,profile_picture_url,websites,vertical'
                    }
                }
            );

            return response.data;
        } catch (error) {
            throw new Error(`Error getting business profile: ${error.response?.data?.error?.message || error.message}`);
        }
    }

    // Verificar si estamos autenticados correctamente
    async verifyAuthentication() {
        try {
            await this.getBusinessProfile();
            return true;
        } catch (error) {
            return false;
        }
    }
}

module.exports = WhatsAppBusinessRepository; 