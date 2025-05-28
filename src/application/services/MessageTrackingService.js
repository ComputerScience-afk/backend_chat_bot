class MessageTrackingService {
    constructor(metaRepository) {
        this.metaRepository = metaRepository;
    }

    async trackMessageDelivery(adId) {
        try {
            // 1. Obtener información del anuncio de Meta
            const adInfo = await this.metaRepository.getAdInfo(adId);
            
            // 2. Obtener insights detallados
            const insights = await this.metaRepository.getAdInsights(adId);
            
            return {
                adInfo,
                insights,
                whatsappMetrics: {
                    ...adInfo.whatsappMetrics,
                    totalConversations: insights?.whatsappMetrics?.conversations || 0,
                    totalReplies: insights?.whatsappMetrics?.replies || 0
                },
                hasWhatsAppActivity: (
                    (adInfo.whatsappMetrics?.conversationsStarted > 0) || 
                    (insights?.whatsappMetrics?.conversations > 0)
                ),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            throw new Error(`Error tracking message delivery: ${error.message}`);
        }
    }
}

module.exports = MessageTrackingService; 