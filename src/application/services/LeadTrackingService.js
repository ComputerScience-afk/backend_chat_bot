class LeadTrackingService {
    constructor(metaRepository, whatsappBusinessRepository) {
        this.metaRepository = metaRepository;
        this.whatsappBusinessRepository = whatsappBusinessRepository;
    }

    async trackLeadsForDay(adId, date = new Date()) {
        try {
            // Configurar el rango de fechas para el día especificado
            const startDate = new Date(date);
            startDate.setHours(0, 0, 0, 0);

            const endDate = new Date(date);
            endDate.setHours(23, 59, 59, 999);

            // 1. Verificar autenticación con WhatsApp Business
            const isAuthenticated = await this.whatsappBusinessRepository.verifyAuthentication();
            if (!isAuthenticated) {
                throw new Error('No se pudo autenticar con WhatsApp Business API');
            }

            // 2. Obtener información del anuncio
            const adInfo = await this.metaRepository.getAdInfo(adId);

            // 3. Obtener leads de WhatsApp para ese anuncio
            const leadsInfo = await this.whatsappBusinessRepository.getLeadsByAdId(
                adId,
                startDate,
                endDate
            );

            return {
                ad: {
                    id: adInfo.id,
                    name: adInfo.name,
                    status: adInfo.status
                },
                leads: {
                    total: leadsInfo.total_leads,
                    details: leadsInfo.leads,
                    date: {
                        start: startDate.toISOString(),
                        end: endDate.toISOString()
                    }
                },
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            throw new Error(`Error tracking leads: ${error.message}`);
        }
    }
}

module.exports = LeadTrackingService; 