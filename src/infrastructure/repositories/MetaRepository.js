const axios = require('axios');

class MetaRepository {
    constructor(config) {
        this.apiVersion = config.apiVersion;
        this.accessToken = config.accessToken;
        this.adAccountId = config.adAccountId;
    }

    async getAdInfo(adId) {
        try {
            const response = await axios.get(
                `https://graph.facebook.com/${this.apiVersion}/${adId}`,
                {
                    params: {
                        access_token: this.accessToken,
                        fields: 'id,name,status,effective_status,insights{impressions,clicks,spend}'
                    }
                }
            );

            return {
                id: response.data.id,
                name: response.data.name,
                status: response.data.status,
                insights: response.data.insights?.data?.[0] || null
            };
        } catch (error) {
            throw new Error(`Meta API Error: ${error.response?.data?.error?.message || error.message}`);
        }
    }

    async getAdInsights(adId) {
        try {
            const response = await axios.get(
                `https://graph.facebook.com/${this.apiVersion}/${adId}/insights`,
                {
                    params: {
                        access_token: this.accessToken,
                        fields: 'impressions,clicks,spend,cpc,ctr',
                        date_preset: 'last_30d'
                    }
                }
            );

            return response.data.data?.[0] || null;
        } catch (error) {
            throw new Error(`Meta Insights API Error: ${error.response?.data?.error?.message || error.message}`);
        }
    }
}

module.exports = MetaRepository; 