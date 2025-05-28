const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const { logger } = require('../../utils/logger');

class ExcelService {
    constructor() {
        this.excelPath = path.join(__dirname, '../../../data/leads.xlsx');
        this.ensureDirectoryExists();
    }

    ensureDirectoryExists() {
        const dir = path.dirname(this.excelPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    async saveLead(leadData) {
        try {
            let workbook = new ExcelJS.Workbook();
            
            if (fs.existsSync(this.excelPath)) {
                await workbook.xlsx.readFile(this.excelPath);
            } else {
                const sheet = workbook.addWorksheet('Leads');
                sheet.columns = [
                    { header: 'Fecha', key: 'fecha', width: 20 },
                    { header: 'Número de WhatsApp', key: 'phoneNumber', width: 15 },
                    { header: 'Ad ID', key: 'adId', width: 15 },
                    { header: 'Nombre del Anuncio', key: 'adName', width: 30 },
                    { header: 'Estado del Anuncio', key: 'adStatus', width: 15 },
                    { header: 'Link de Facebook', key: 'fbLink', width: 50 },
                    { header: 'Impresiones', key: 'impressions', width: 12 },
                    { header: 'Clicks', key: 'clicks', width: 10 },
                    { header: 'Gasto', key: 'spend', width: 10 },
                    { header: 'CTR', key: 'ctr', width: 10 },
                    { header: 'CPC', key: 'cpc', width: 10 }
                ];
            }

            const sheet = workbook.getWorksheet('Leads');
            
            // Agregar nuevo lead
            sheet.addRow({
                fecha: new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' }),
                phoneNumber: leadData.phoneNumber,
                adId: leadData.adInfo.id,
                adName: leadData.adInfo.name,
                adStatus: leadData.adInfo.status,
                fbLink: leadData.adInfo.fbLink || '',
                impressions: leadData.insights?.impressions || 0,
                clicks: leadData.insights?.clicks || 0,
                spend: leadData.insights?.spend || 0,
                ctr: leadData.insights?.ctr || 0,
                cpc: leadData.insights?.cpc || 0
            });

            // Guardar archivo
            await workbook.xlsx.writeFile(this.excelPath);
            logger.info(`Lead saved successfully for phone number: ${leadData.phoneNumber}`);
            
            return true;
        } catch (error) {
            logger.error('Error saving lead to Excel:', error);
            throw error;
        }
    }

    async getLeads() {
        try {
            if (!fs.existsSync(this.excelPath)) {
                return [];
            }

            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.readFile(this.excelPath);
            const sheet = workbook.getWorksheet('Leads');
            
            return sheet.getRows(2, sheet.rowCount).map(row => ({
                fecha: row.getCell('fecha').value,
                phoneNumber: row.getCell('phoneNumber').value,
                adId: row.getCell('adId').value,
                adName: row.getCell('adName').value,
                adStatus: row.getCell('adStatus').value,
                fbLink: row.getCell('fbLink').value,
                impressions: row.getCell('impressions').value,
                clicks: row.getCell('clicks').value,
                spend: row.getCell('spend').value,
                ctr: row.getCell('ctr').value,
                cpc: row.getCell('cpc').value
            }));
        } catch (error) {
            logger.error('Error reading leads from Excel:', error);
            throw error;
        }
    }
}

module.exports = new ExcelService(); 