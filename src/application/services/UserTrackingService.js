const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const { logger } = require('../../utils/logger');

class UserTrackingService {
    constructor() {
        this.workbook = null;
        this.filePath = path.join(process.cwd(), 'data', 'user_tracking.xlsx');
        this.initialized = false;
        this.retryAttempts = 5;
        this.retryDelay = 500;
        this.maxWaitTime = 10000;
        this.fileLock = new Map();
        this.lockTimeout = new Map();
    }

    async init() {
        if (this.initialized) return;

        try {
            await this.ensureDirectoryExists();
            await this.initializeWorkbook();
            this.initialized = true;
            logger.info('UserTrackingService initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize UserTrackingService:', error);
            // Intentar crear un nuevo archivo si hay error
            try {
                logger.info('Attempting to create new workbook...');
                this.workbook = new ExcelJS.Workbook();
                await this.createAllWorksheets();
                this.initialized = true;
                logger.info('Successfully created new workbook');
            } catch (retryError) {
                logger.error('Failed to create new workbook:', retryError);
                throw retryError;
            }
        }
    }

    async ensureDirectoryExists() {
        const dir = path.dirname(this.filePath);
        try {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                logger.info(`Created directory: ${dir}`);
            }
            
            // Si el archivo existe pero está corrupto, intentar eliminarlo
            if (fs.existsSync(this.filePath)) {
                try {
                    const stats = fs.statSync(this.filePath);
                    if (stats.size === 0) {
                        logger.warn('Found empty Excel file, deleting it...');
                        fs.unlinkSync(this.filePath);
                    }
                } catch (error) {
                    logger.warn('Error checking file stats, attempting to delete:', error);
                    try {
                        fs.unlinkSync(this.filePath);
                    } catch (unlinkError) {
                        logger.error('Failed to delete corrupted file:', unlinkError);
                    }
                }
            }
        } catch (error) {
            logger.error('Error ensuring directory exists:', error);
            throw error;
        }
    }

    async acquireLock(operation = 'default') {
        const startTime = Date.now();
        const lockId = `${operation}_${Date.now()}`;
        
        while (this.fileLock.get(operation)) {
            const lastLockTime = this.lockTimeout.get(operation);
            if (lastLockTime && (Date.now() - lastLockTime > this.maxWaitTime)) {
                logger.warn(`Lock timeout detected for operation ${operation}, forcing release`);
                this.releaseLock(operation);
                break;
            }

            if (Date.now() - startTime > this.maxWaitTime) {
                logger.error(`Lock acquisition timeout for operation ${operation}`);
                throw new Error(`Lock acquisition timeout for ${operation}`);
            }

            const randomDelay = Math.floor(Math.random() * 200) + 100;
            await new Promise(resolve => setTimeout(resolve, randomDelay));
        }
        
        this.fileLock.set(operation, lockId);
        this.lockTimeout.set(operation, Date.now());
        logger.debug(`Lock acquired for operation ${operation}`);
    }

    async releaseLock(operation = 'default') {
        this.fileLock.delete(operation);
        this.lockTimeout.delete(operation);
        logger.debug(`Lock released for operation ${operation}`);
    }

    async tryOperation(operation, attempts = 0) {
        try {
            await this.acquireLock(operation);
            const result = await operation();
            await this.releaseLock(operation);
            return result;
        } catch (error) {
            await this.releaseLock(operation);
            
            if ((error.code === 'EBUSY' || error.message.includes('timeout')) && attempts < this.retryAttempts) {
                logger.info(`Retrying operation (attempt ${attempts + 1}/${this.retryAttempts})`);
                const delay = Math.min(this.retryDelay * Math.pow(2, attempts) + Math.random() * 1000, 5000);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.tryOperation(operation, attempts + 1);
            }
            
            throw error;
        }
    }

    async initializeWorkbook() {
        try {
            this.workbook = new ExcelJS.Workbook();

            if (fs.existsSync(this.filePath)) {
                await this.tryOperation(async () => {
                    try {
                        await this.workbook.xlsx.readFile(this.filePath);
                        // Verificar que el archivo se cargó correctamente
                        if (!this.workbook.worksheets || this.workbook.worksheets.length === 0) {
                            throw new Error('Invalid workbook structure');
                        }
                    } catch (error) {
                        logger.warn('Error reading existing Excel file:', error);
                        // Crear nuevo archivo si hay cualquier error
                        await this.createAllWorksheets();
                        return;
                    }
                    await this.ensureWorksheets();
                }, 'initialize');
            } else {
                logger.info('Excel file not found, creating new workbook');
                await this.createAllWorksheets();
            }
        } catch (error) {
            logger.error('Error in initializeWorkbook:', error);
            throw error;
        }
    }

    async ensureWorksheets() {
        const requiredSheets = ['Organic Users', 'Pauta', 'Leads'];
        for (const sheetName of requiredSheets) {
            if (!this.workbook.getWorksheet(sheetName)) {
                logger.info(`Creating missing worksheet: ${sheetName}`);
                await this.createWorksheet(sheetName);
            }
        }
        await this.saveWorkbook();
    }

    async createAllWorksheets() {
        await this.createWorksheet('Organic Users', [
            { header: 'Fecha', key: 'date', width: 15 },
            { header: 'Hora', key: 'time', width: 12 },
            { header: 'Teléfono', key: 'phone', width: 15 },
            { header: 'Nombre', key: 'name', width: 20 },
            { header: 'Primera Interacción', key: 'firstContact', width: 20 },
            { header: 'Última Interacción', key: 'lastContact', width: 20 },
            { header: 'Total Interacciones', key: 'interactions', width: 10 },
            { header: 'Última Consulta', key: 'lastIntent', width: 50 }
        ]);

        await this.createWorksheet('Pauta', [
            { header: 'Fecha', key: 'date', width: 15 },
            { header: 'Hora', key: 'time', width: 12 },
            { header: 'Teléfono', key: 'phone', width: 15 },
            { header: 'Nombre', key: 'name', width: 20 },
            { header: 'ID Anuncio', key: 'adId', width: 15 },
            { header: 'Campaña', key: 'campaign', width: 20 },
            { header: 'Primera Interacción', key: 'firstContact', width: 20 },
            { header: 'Última Interacción', key: 'lastContact', width: 20 },
            { header: 'Total Interacciones', key: 'interactions', width: 10 },
            { header: 'Última Consulta', key: 'lastIntent', width: 50 }
        ]);

        await this.createWorksheet('Leads', [
            { header: 'Fecha', key: 'date', width: 15 },
            { header: 'Hora', key: 'time', width: 12 },
            { header: 'Teléfono', key: 'phone', width: 15 },
            { header: 'Nombre', key: 'name', width: 20 },
            { header: 'Ubicación', key: 'location', width: 20 },
            { header: 'Síntomas', key: 'symptoms', width: 50 },
            { header: 'Origen', key: 'source', width: 15 },
            { header: 'ID Campaña', key: 'campaignId', width: 15 }
        ]);

        await this.saveWorkbook();
    }

    async createWorksheet(name, columns) {
        try {
            const sheet = this.workbook.addWorksheet(name);
            sheet.columns = columns;

            // Aplicar estilos al encabezado
            sheet.getRow(1).font = { bold: true };
            sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
            
            logger.info(`Worksheet ${name} created successfully`);
        } catch (error) {
            logger.error(`Error creating worksheet ${name}:`, error);
            throw error;
        }
    }

    validateData(data) {
        // Validar teléfono
        if (data.phone && !/^\d{9,15}$/.test(data.phone.replace(/\D/g, ''))) {
            throw new Error('Invalid phone number format');
        }

        // Validar nombre
        if (data.name && (typeof data.name !== 'string' || data.name.length < 2)) {
            throw new Error('Invalid name format');
        }

        // Validar ubicación
        if (data.location && typeof data.location !== 'string') {
            throw new Error('Invalid location format');
        }

        // Validar síntomas
        if (data.symptoms && !Array.isArray(data.symptoms)) {
            throw new Error('Symptoms must be an array');
        }

        return true;
    }

    async saveWorkbook() {
        if (!this.workbook) {
            throw new Error('Workbook not initialized');
        }

        let attempts = 0;
        const maxAttempts = 5;
        const baseDelay = 500;

        while (attempts < maxAttempts) {
            try {
                // Asegurarse de que el directorio existe
                await this.ensureDirectoryExists();
                
                // Intentar guardar el archivo
                await this.workbook.xlsx.writeFile(this.filePath);
                logger.info('Workbook saved successfully');
                return;
            } catch (error) {
                attempts++;
                logger.warn(`Error saving workbook (attempt ${attempts}/${maxAttempts}):`, error);

                if (attempts === maxAttempts) {
                    logger.error('Failed to save workbook after maximum attempts');
                    throw error;
                }

                // Esperar con backoff exponencial y componente aleatorio
                const delay = Math.min(baseDelay * Math.pow(2, attempts - 1) + Math.random() * 1000, 5000);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    getPeruDateTime() {
        return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Lima' }));
    }

    formatPeruDate(date) {
        return date.toLocaleDateString('es-PE', {
            timeZone: 'America/Lima',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
    }

    formatPeruTime(date) {
        return date.toLocaleTimeString('es-PE', {
            timeZone: 'America/Lima',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    }

    async ensureInitialized() {
        if (!this.initialized) {
            await this.init();
        }
    }

    async trackUser(userData) {
        await this.ensureInitialized();

        await this.tryOperation(async () => {
            try {
                const peruDateTime = this.getPeruDateTime();
                const isFromAd = !!userData.campaignId && userData.campaignId !== 'N/A';
                
                // 1. Actualizar hoja correspondiente (Organic o Pauta)
                const sourceSheet = this.workbook.getWorksheet(isFromAd ? 'Pauta' : 'Organic Users');
                if (!sourceSheet) throw new Error(`Sheet ${isFromAd ? 'Pauta' : 'Organic Users'} not found`);

                // Buscar usuario existente
                let existingRow = null;
                sourceSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
                    if (rowNumber > 1 && row.getCell('phone').value === userData.phone) {
                        existingRow = row;
                    }
                });

                if (existingRow) {
                    // Actualizar usuario existente
                    existingRow.getCell('lastContact').value = peruDateTime.toISOString();
                    existingRow.getCell('interactions').value = (existingRow.getCell('interactions').value || 0) + 1;
                    existingRow.getCell('lastIntent').value = userData.symptoms?.[0] || 'No registrado';
                    if (userData.name) existingRow.getCell('name').value = userData.name;
                } else {
                    // Crear nuevo registro
                    const newUserData = {
                        date: this.formatPeruDate(peruDateTime),
                        time: this.formatPeruTime(peruDateTime),
                phone: userData.phone,
                        name: userData.name || 'No proporcionado',
                        firstContact: peruDateTime.toISOString(),
                        lastContact: peruDateTime.toISOString(),
                interactions: 1,
                        lastIntent: userData.symptoms?.[0] || 'No registrado'
                    };

                    if (isFromAd) {
                        newUserData.adId = userData.campaignId;
                        newUserData.campaign = userData.source || 'Facebook';
                    }

                    sourceSheet.addRow(newUserData);
                }

                // 2. Actualizar hoja de Leads si hay síntomas o ubicación
                if (userData.symptoms?.length > 0 || userData.location) {
                    const leadsSheet = this.workbook.getWorksheet('Leads');
                    if (!leadsSheet) throw new Error('Leads sheet not found');

                    // Verificar si ya existe un lead para hoy
                    const todayDate = this.formatPeruDate(peruDateTime);
                    let existingLead = false;

                    leadsSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
                        if (rowNumber > 1) {
                            const rowDate = row.getCell('date').value;
                            const rowPhone = row.getCell('phone').value;
                            if (rowDate === todayDate && rowPhone === userData.phone) {
                                existingLead = true;
                            }
                        }
                    });

                    if (!existingLead) {
                        const leadData = {
                            date: todayDate,
                            time: this.formatPeruTime(peruDateTime),
                            phone: userData.phone,
                            name: userData.name || 'No proporcionado',
                            location: userData.location || 'No proporcionada',
                            symptoms: Array.isArray(userData.symptoms) ? userData.symptoms.join(', ') : (userData.symptoms || 'No registrados'),
                            source: isFromAd ? 'Facebook Ads' : 'Orgánico',
                            campaignId: userData.campaignId || 'N/A'
                        };

                        leadsSheet.addRow(leadData);
                    }
                }

                await this.saveWorkbook();
                logger.info(`User tracked successfully: ${userData.phone} (${isFromAd ? 'Pauta' : 'Orgánico'})`);

            } catch (error) {
                logger.error('Error in trackUser:', error);
                this.initialized = false;
                throw error;
            }
        });
    }

    async trackObjection(userData) {
        await this.ensureInitialized();

        await this.tryOperation(async () => {
            try {
                const peruDateTime = this.getPeruDateTime();
                
                // Crear hoja de objeciones si no existe
                let objectionsSheet = this.workbook.getWorksheet('Objeciones');
                if (!objectionsSheet) {
                    objectionsSheet = this.workbook.addWorksheet('Objeciones');
                    objectionsSheet.columns = [
                        { header: 'Fecha', key: 'date', width: 15 },
                        { header: 'Hora', key: 'time', width: 12 },
                        { header: 'Teléfono', key: 'phone', width: 15 },
                        { header: 'Nombre', key: 'name', width: 20 },
                        { header: 'Tipo Objeción', key: 'objectionType', width: 20 },
                        { header: 'Mensaje Original', key: 'originalMessage', width: 50 },
                        { header: 'Estado', key: 'status', width: 15 } // 'activa', 'superada', 'perdido'
                    ];
                    
                    // Aplicar estilos al encabezado
                    objectionsSheet.getRow(1).font = { bold: true };
                    objectionsSheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
                }

                // Agregar nueva objeción
                const newRow = objectionsSheet.addRow({
                    date: this.formatPeruDate(peruDateTime),
                    time: this.formatPeruTime(peruDateTime),
                    phone: userData.phone,
                    name: userData.name || 'No proporcionado',
                    objectionType: userData.objection_type,
                    originalMessage: userData.originalMessage || '',
                    status: 'activa'
                });

                await this.saveWorkbook();
                logger.info('Objection tracked successfully:', {
                    phone: userData.phone,
                    type: userData.objection_type
                });

            } catch (error) {
                logger.error('Error tracking objection:', error);
                throw error;
            }
        });
    }

    async trackFreeConsultation(userData) {
        await this.ensureInitialized();

        await this.tryOperation(async () => {
            try {
                const peruDateTime = this.getPeruDateTime();
                
                // Crear hoja de consultas gratuitas si no existe
                let freeConsultationsSheet = this.workbook.getWorksheet('Consultas Gratuitas');
                if (!freeConsultationsSheet) {
                    freeConsultationsSheet = this.workbook.addWorksheet('Consultas Gratuitas');
                    freeConsultationsSheet.columns = [
                        { header: 'Fecha Oferta', key: 'offerDate', width: 15 },
                        { header: 'Hora Oferta', key: 'offerTime', width: 12 },
                        { header: 'Teléfono', key: 'phone', width: 15 },
                        { header: 'Nombre', key: 'name', width: 20 },
                        { header: 'Motivo Oferta', key: 'reason', width: 30 }, // precio, desinteres, comparacion
                        { header: 'Aceptó Oferta', key: 'accepted', width: 15 }, // si, no, pendiente
                        { header: 'Fecha Cita', key: 'appointmentDate', width: 15 },
                        { header: 'Sede', key: 'location', width: 15 },
                        { header: 'Estado', key: 'status', width: 15 } // programada, asistió, no asistió, cancelada
                    ];
                    
                    // Aplicar estilos al encabezado
                    freeConsultationsSheet.getRow(1).font = { bold: true };
                    freeConsultationsSheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
                }

                // Agregar nueva consulta gratuita
                const newRow = freeConsultationsSheet.addRow({
                    offerDate: this.formatPeruDate(peruDateTime),
                    offerTime: this.formatPeruTime(peruDateTime),
                    phone: userData.phone,
                    name: userData.name || 'No proporcionado',
                    reason: userData.reason || 'No especificado', // precio, desinteres, comparacion
                    accepted: 'pendiente',
                    appointmentDate: '',
                    location: '',
                    status: 'oferta_realizada'
                });

                await this.saveWorkbook();
                logger.info('Free consultation offer tracked successfully:', {
                    phone: userData.phone,
                    reason: userData.reason
                });

            } catch (error) {
                logger.error('Error tracking free consultation:', error);
                throw error;
            }
        });
    }

    async getStats() {
        await this.ensureInitialized();

        return this.tryOperation(async () => {
            try {
                const peruDateTime = this.getPeruDateTime();
                const todayDate = this.formatPeruDate(peruDateTime);
                const stats = {
                    organicUsers: { total: 0, today: 0 },
                    pautaUsers: { total: 0, today: 0 },
                    leads: { total: 0, today: 0 },
                    lastUpdate: peruDateTime.toISOString()
                };

                // Contar Organic Users
                const organicSheet = this.workbook.getWorksheet('Organic Users');
                if (organicSheet) {
                    organicSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
                        if (rowNumber > 1) {
                            stats.organicUsers.total++;
                            if (row.getCell('date').value === todayDate) {
                                stats.organicUsers.today++;
                            }
                        }
                    });
                }

                // Contar Pauta
                const pautaSheet = this.workbook.getWorksheet('Pauta');
                if (pautaSheet) {
                    pautaSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
                        if (rowNumber > 1) {
                            stats.pautaUsers.total++;
                            if (row.getCell('date').value === todayDate) {
                                stats.pautaUsers.today++;
                            }
                        }
                    });
                }

                // Contar Leads
                const leadsSheet = this.workbook.getWorksheet('Leads');
                if (leadsSheet) {
                    leadsSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
                        if (rowNumber > 1) {
                            stats.leads.total++;
                            if (row.getCell('date').value === todayDate) {
                                stats.leads.today++;
                            }
                        }
                    });
                }

                return stats;
            } catch (error) {
                logger.error('Error in getStats:', error);
        return {
                    organicUsers: { total: 0, today: 0 },
                    pautaUsers: { total: 0, today: 0 },
                    leads: { total: 0, today: 0 },
                    lastUpdate: this.getPeruDateTime().toISOString()
                };
            }
        });
    }
}

module.exports = UserTrackingService; 