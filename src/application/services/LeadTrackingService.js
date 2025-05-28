const { Lead, CampaignLeadDetail } = require('../../infrastructure/database/models');
const { logger } = require('../../utils/logger');
const { getCurrentPeruDate, getPeruStartOfDay, getPeruEndOfDay } = require('../../utils/dateUtils');
const { Op } = require('sequelize');

class LeadTrackingService {
    constructor(metaRepository, whatsappBusinessRepository) {
        this.metaRepository = metaRepository;
        this.whatsappBusinessRepository = whatsappBusinessRepository;
    }

    async trackLeadsForDay(adId, date = getCurrentPeruDate()) {
        try {
            // Configurar el rango de fechas para el día especificado en Perú
            const startDate = getPeruStartOfDay(date);
            const endDate = getPeruEndOfDay(date);

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
                timestamp: getCurrentPeruDate().toISOString()
            };
        } catch (error) {
            throw new Error(`Error tracking leads: ${error.message}`);
        }
    }

    async createOrUpdateLead(data) {
        try {
            const {
                telefono,
                nombre,
                ubicacion,
                sintomas,
                origen = 'whatsapp',
                tipo_lead = 'organic',
                id_campana,
                id_anuncio
            } = data;

            const currentDate = getCurrentPeruDate();
            const startOfDay = getPeruStartOfDay(currentDate);
            const endOfDay = getPeruEndOfDay(currentDate);

            // Convertir sintomas a string si es un array
            const sintomasStr = Array.isArray(sintomas) ? sintomas.join(', ') : sintomas || '';

            // Buscar lead existente para hoy
            let lead = await Lead.findOne({
                where: {
                    telefono,
                    createdAt: {
                        [Op.between]: [startOfDay, endOfDay]
                    }
                }
            });

            if (!lead) {
                // Si no existe un lead para hoy, crear uno nuevo
                lead = await Lead.create({
                    telefono,
                    nombre,
                    ubicacion,
                    sintomas: sintomasStr,
                    origen,
                    tipo_lead,
                    primera_interaccion: currentDate,
                    ultima_interaccion: currentDate,
                    fecha: currentDate,
                    hora: currentDate
                });

                // Si es un lead de campaña, crear los detalles
                if (tipo_lead === 'campaign' && (id_campana || id_anuncio)) {
                    await CampaignLeadDetail.create({
                        lead_id: lead.id,
                        id_campana,
                        id_anuncio,
                        // Obtener información adicional de Meta si está disponible
                        ...(await this.getMetaCampaignDetails(id_campana, id_anuncio))
                    });
                }

                logger.info(`Nuevo lead creado para el día ${currentDate.toISOString()}`);
            } else {
                // Actualizar lead existente
                await lead.update({
                    nombre: nombre || lead.nombre,
                    ubicacion: ubicacion || lead.ubicacion,
                    sintomas: sintomasStr || lead.sintomas,
                    ultima_interaccion: currentDate
                });

                // Actualizar detalles de campaña si es necesario
                if (tipo_lead === 'campaign' && (id_campana || id_anuncio)) {
                    await CampaignLeadDetail.findOrCreate({
                        where: { lead_id: lead.id },
                        defaults: {
                            lead_id: lead.id,
                            id_campana,
                            id_anuncio,
                            ...(await this.getMetaCampaignDetails(id_campana, id_anuncio))
                        }
                    });
                }

                logger.info(`Lead actualizado para el día ${currentDate.toISOString()}`);
            }

            return lead;
        } catch (error) {
            logger.error('Error in createOrUpdateLead:', error);
            throw error;
        }
    }

    async getMetaCampaignDetails(campaignId, adId) {
        try {
            if (!this.metaRepository) {
                return {};
            }

            const details = {};

            if (campaignId) {
                const campaignInfo = await this.metaRepository.getCampaignInfo(campaignId);
                if (campaignInfo) {
                    details.campaign_name = campaignInfo.name;
                    details.campaign_status = campaignInfo.status;
                    details.campaign_objective = campaignInfo.objective;
                }
            }

            if (adId) {
                const adInfo = await this.metaRepository.getAdInfo(adId);
                if (adInfo) {
                    details.ad_name = adInfo.name;
                    details.ad_status = adInfo.status;
                    details.ad_creative = adInfo.creative_type;
                }
            }

            return details;
        } catch (error) {
            logger.error('Error getting Meta campaign details:', error);
            return {};
        }
    }

    async updateLastConsulta(telefono) {
        try {
            const lead = await Lead.findOne({ where: { telefono } });
            if (lead) {
                await lead.update({
                    ultima_consulta: getCurrentPeruDate()
                });
                logger.info('Last consulta updated successfully');
            }
        } catch (error) {
            logger.error('Error updating last consulta:', error);
            throw error;
        }
    }

    async toggleBotStatus(telefono) {
        try {
            const lead = await Lead.findOne({ where: { telefono } });
            if (lead) {
                await lead.update({
                    is_bot_active: !lead.is_bot_active
                });
                logger.info(`Bot status toggled to ${!lead.is_bot_active} for ${telefono}`);
                return !lead.is_bot_active;
            }
            return null;
        } catch (error) {
            logger.error('Error toggling bot status:', error);
            throw error;
        }
    }

    async getStats() {
        try {
            const currentDate = getCurrentPeruDate();
            const startOfDay = getPeruStartOfDay(currentDate);
            const endOfDay = getPeruEndOfDay(currentDate);
            
            const stats = {
                total_leads: await Lead.count(),
                leads_today: await Lead.count({
                    where: {
                        createdAt: {
                            [Op.between]: [startOfDay, endOfDay]
                        }
                    }
                }),
                organic_leads: await Lead.count({ 
                    where: { 
                        tipo_lead: 'organic',
                        createdAt: {
                            [Op.between]: [startOfDay, endOfDay]
                        }
                    } 
                }),
                campaign_leads: await Lead.count({ 
                    where: { 
                        tipo_lead: 'campaign',
                        createdAt: {
                            [Op.between]: [startOfDay, endOfDay]
                        }
                    } 
                }),
                active_bots: await Lead.count({ 
                    where: { 
                        is_bot_active: true,
                        ultima_interaccion: {
                            [Op.between]: [startOfDay, endOfDay]
                        }
                    } 
                })
            };

            logger.info('Stats retrieved successfully');
            return stats;
        } catch (error) {
            logger.error('Error getting stats:', error);
            throw error;
        }
    }

    async getLeadDetails(telefono) {
        try {
            const lead = await Lead.findOne({
                where: { telefono },
                include: [
                    {
                        model: CampaignLeadDetail,
                        as: 'campaignDetails',
                        required: false
                    }
                ]
            });

            return lead;
        } catch (error) {
            logger.error('Error getting lead details:', error);
            throw error;
        }
    }
}

module.exports = LeadTrackingService; 